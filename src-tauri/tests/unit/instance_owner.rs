// EXCEPTION to tests-folder conventions: process-lock acquisition is a
// private startup primitive; widening it only for an integration test would
// make the ownership boundary less clear.
use super::*;

#[test]
fn simultaneous_claims_have_exactly_one_owner() {
    let dir = tempfile::tempdir().unwrap();
    let root = std::sync::Arc::new(dir.path().to_path_buf());
    let start = std::sync::Arc::new(std::sync::Barrier::new(3));
    let hold = std::sync::Arc::new(std::sync::Barrier::new(3));
    let mut workers = Vec::new();
    for _ in 0..2 {
        let root = root.clone();
        let start = start.clone();
        let hold = hold.clone();
        workers.push(std::thread::spawn(move || {
            start.wait();
            let claim = claim(&root).unwrap();
            let primary = matches!(claim, Claim::Primary { .. });
            hold.wait();
            primary
        }));
    }
    start.wait();
    hold.wait();

    assert_eq!(
        workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .filter(|primary| *primary)
            .count(),
        1
    );
}

#[test]
fn exactly_one_claim_owns_a_root_and_drop_releases_it() {
    let dir = tempfile::tempdir().unwrap();
    let first = claim(dir.path()).unwrap();
    assert!(matches!(first, Claim::Primary { .. }));
    assert!(matches!(
        claim(dir.path()).unwrap(),
        Claim::Secondary { .. }
    ));

    drop(first);
    assert!(matches!(claim(dir.path()).unwrap(), Claim::Primary { .. }));
}

#[test]
fn secondary_activation_uses_the_published_endpoint() {
    let dir = tempfile::tempdir().unwrap();
    let Claim::Primary {
        lock: _lock,
        listener,
    } = claim(dir.path()).unwrap()
    else {
        panic!("first claim must own the root");
    };
    listener.set_nonblocking(false).unwrap();
    let Claim::Secondary { endpoint_path } = claim(dir.path()).unwrap() else {
        panic!("second claim must be secondary");
    };

    let receiver = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = String::new();
        stream.read_to_string(&mut request).unwrap();
        request
    });
    notify_primary(&endpoint_path).unwrap();
    assert_eq!(receiver.join().unwrap(), "activate");
}

#[test]
fn an_activation_that_arrives_after_the_connection_is_still_read() {
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
    listener.set_nonblocking(true).unwrap();
    let address = listener.local_addr().unwrap();
    let sender = std::thread::spawn(move || {
        let mut stream = TcpStream::connect(address).unwrap();
        std::thread::sleep(Duration::from_millis(100));
        stream.write_all(b"activate").unwrap();
    });
    let mut accepted = loop {
        match listener.accept() {
            Ok((stream, _)) => break stream,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(RETRY_DELAY),
            Err(error) => panic!("{error}"),
        }
    };
    assert!(is_activation(&mut accepted));
    sender.join().unwrap();
}

#[test]
fn a_connection_that_sends_something_else_is_not_an_activation() {
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
    let address = listener.local_addr().unwrap();
    let sender = std::thread::spawn(move || {
        TcpStream::connect(address).unwrap().write_all(b"hello").unwrap();
    });
    let (mut accepted, _) = listener.accept().unwrap();
    sender.join().unwrap();
    assert!(!is_activation(&mut accepted));
}

fn parse_request(bytes: &'static [u8], token: &'static str) -> Request {
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
    let address = listener.local_addr().unwrap();
    let sender = std::thread::spawn(move || {
        TcpStream::connect(address).unwrap().write_all(bytes).unwrap();
    });
    let (mut stream, _) = listener.accept().unwrap();
    let request = read_request(&mut stream, token);
    sender.join().unwrap();
    request
}

#[test]
fn quit_requires_the_complete_current_launch_token() {
    assert_eq!(parse_request(b"quit____current\n", "current"), Request::Quit);
    assert_eq!(parse_request(b"quit____old\n", "current"), Request::Unknown);
    assert_eq!(parse_request(b"quit____current", "current"), Request::Unknown);
    assert_eq!(parse_request(b"quit____\n", ""), Request::Unknown);
    assert_eq!(parse_request(b"status__", "current"), Request::Status);
    assert_eq!(parse_request(b"activate", "current"), Request::Activate);
}

#[test]
fn an_incomplete_client_does_not_occupy_the_listener_indefinitely() {
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
    let address = listener.local_addr().unwrap();
    let mut client = TcpStream::connect(address).unwrap();
    client.write_all(b"quit____cur").unwrap();
    let (done, completed) = std::sync::mpsc::channel();
    let reader = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        done.send(read_request(&mut stream, "current")).unwrap();
    });
    assert_eq!(completed.recv_timeout(Duration::from_secs(10)).unwrap(), Request::Unknown);
    drop(client);
    reader.join().unwrap();
}

#[test]
fn each_claim_publishes_a_complete_endpoint_without_a_staging_file() {
    let dir = tempfile::tempdir().unwrap();
    for _ in 0..3 {
        let Claim::Primary { lock: _lock, listener } = claim(dir.path()).unwrap() else { panic!() };
        let published = std::fs::read_to_string(dir.path().join(ENDPOINT_FILE_NAME)).unwrap();
        let mut lines = published.lines();
        assert_eq!(lines.next().unwrap().parse::<u16>().unwrap(), listener.local_addr().unwrap().port());
        let metadata: serde_json::Value = serde_json::from_str(lines.next().unwrap()).unwrap();
        assert!(metadata["token"].is_string());
        assert!(metadata["launcherRoot"].is_string());
        assert!(!dir.path().join("instance.endpoint.tmp").exists());
    }
}

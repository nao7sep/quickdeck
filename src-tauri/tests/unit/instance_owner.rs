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

use super::*;

fn admission() -> Arc<ReadAdmission> {
    Arc::new(ReadAdmission {
        active: AtomicUsize::new(0),
        limit: 1,
    })
}

fn database() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join(RECORDS_DB_FILE_NAME);
    let conn = Connection::open(&file).unwrap();
    conn.execute_batch(SCHEMA).unwrap();
    conn.pragma_update(None, "user_version", format_version::RECORDS)
        .unwrap();
    (dir, file)
}

fn wait_for_settlement(admission: &ReadAdmission) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while admission.active.load(Ordering::Acquire) != 0 {
        assert!(Instant::now() < deadline, "blocking read did not settle");
        std::thread::sleep(Duration::from_millis(1));
    }
}

#[test]
fn a_timed_out_sqlite_query_is_interrupted_and_a_subsequent_read_succeeds() {
    let (_dir, file) = database();
    let admission = admission();
    let (settled, query_result) = mpsc::channel();
    let outcome = read_with_wait(
        file.clone(),
        move |conn| {
            let result = conn.query_row(
                "WITH RECURSIVE sequence(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM sequence)
                 SELECT sum(n) FROM sequence",
                [],
                |row| row.get::<_, i64>(0),
            );
            settled
                .send(
                    result
                        .as_ref()
                        .err()
                        .and_then(|error| error.sqlite_error_code()),
                )
                .unwrap();
            result
        },
        Duration::from_millis(100),
        Arc::clone(&admission),
        open,
    );
    assert!(outcome.is_err());
    assert_eq!(
        query_result.recv_timeout(Duration::from_secs(5)).unwrap(),
        Some(rusqlite::ErrorCode::OperationInterrupted)
    );
    wait_for_settlement(&admission);
    assert_eq!(
        read_with_wait(
            file,
            |conn| conn.query_row("SELECT 42", [], |row| row.get::<_, i64>(0)),
            Duration::from_secs(5),
            admission,
            open
        )
        .unwrap(),
        42
    );
}

#[test]
fn caller_timeout_keeps_capacity_until_the_read_closure_physically_exits() {
    let (_dir, file) = database();
    let admission = admission();
    let (entered, started) = mpsc::channel();
    let (release, blocked) = mpsc::channel();
    let caller_admission = Arc::clone(&admission);
    let caller_file = file.clone();
    let caller = std::thread::spawn(move || {
        read_with_wait(
            caller_file,
            move |_| {
                entered.send(()).unwrap();
                blocked.recv().unwrap();
                Ok(())
            },
            Duration::from_millis(100),
            caller_admission,
            open,
        )
    });
    started.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(caller.join().unwrap().is_err());
    assert_eq!(admission.active.load(Ordering::Acquire), 1);
    let refused = read_with_wait::<()>(
        file.clone(),
        |_| panic!("capacity must reject before starting"),
        Duration::from_secs(5),
        Arc::clone(&admission),
        open,
    );
    assert!(refused.unwrap_err().contains("capacity"));
    release.send(()).unwrap();
    wait_for_settlement(&admission);
    assert!(read_with_wait(file, |_| Ok(()), Duration::from_secs(5), admission, open).is_ok());
}

#[test]
fn a_stalled_open_retains_capacity_and_cannot_start_a_read_after_timeout() {
    let (_dir, file) = database();
    let admission = admission();
    let invoked = Arc::new(AtomicBool::new(false));
    let worker_invoked = Arc::clone(&invoked);
    let (entered, started) = mpsc::channel();
    let (release, blocked) = mpsc::channel();
    let caller_admission = Arc::clone(&admission);
    let caller = std::thread::spawn(move || {
        read_with_wait(
            file,
            move |_| {
                worker_invoked.store(true, Ordering::Release);
                Ok(())
            },
            Duration::from_millis(100),
            caller_admission,
            move |file| {
                entered.send(()).unwrap();
                blocked.recv().unwrap();
                open(file)
            },
        )
    });
    started.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(caller.join().unwrap().is_err());
    assert_eq!(admission.active.load(Ordering::Acquire), 1);
    assert!(admission.acquire().is_err());
    release.send(()).unwrap();
    wait_for_settlement(&admission);
    assert!(!invoked.load(Ordering::Acquire));
    assert!(admission.acquire().is_ok());
}

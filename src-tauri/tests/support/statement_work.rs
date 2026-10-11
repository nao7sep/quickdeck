//! Observe the real production statements without exposing a test-only query API.
use std::ffi::{c_int, c_uint, c_void};

use rusqlite::{ffi, Connection};

#[derive(Debug, Default)]
pub struct Work {
    pub scans: i32,
    pub sorts: i32,
    pub steps: i32,
}

unsafe extern "C" fn profile(
    kind: c_uint,
    context: *mut c_void,
    statement: *mut c_void,
    _: *mut c_void,
) -> c_int {
    if kind == ffi::SQLITE_TRACE_PROFILE {
        // SQLite calls this synchronously, before finalizing the statement.
        // The boxed context stays alive until the trace registration is removed.
        let work = unsafe { &mut *context.cast::<Work>() };
        let statement = statement.cast::<ffi::sqlite3_stmt>();
        work.scans +=
            unsafe { ffi::sqlite3_stmt_status(statement, ffi::SQLITE_STMTSTATUS_FULLSCAN_STEP, 0) };
        work.sorts +=
            unsafe { ffi::sqlite3_stmt_status(statement, ffi::SQLITE_STMTSTATUS_SORT, 0) };
        work.steps +=
            unsafe { ffi::sqlite3_stmt_status(statement, ffi::SQLITE_STMTSTATUS_VM_STEP, 0) };
    }
    0
}

struct Registration<'a>(&'a Connection);

impl Drop for Registration<'_> {
    fn drop(&mut self) {
        // Also unregister on panic, before the boxed callback context is dropped.
        unsafe {
            ffi::sqlite3_trace_v2(self.0.handle(), 0, None, std::ptr::null_mut());
        }
    }
}

pub fn measure<T>(conn: &Connection, operation: impl FnOnce() -> T) -> (T, Work) {
    let mut work = Box::<Work>::default();
    let registered = unsafe {
        ffi::sqlite3_trace_v2(
            conn.handle(),
            ffi::SQLITE_TRACE_PROFILE,
            Some(profile),
            (&mut *work as *mut Work).cast(),
        )
    };
    assert_eq!(registered, ffi::SQLITE_OK);
    let registration = Registration(conn);
    let result = operation();
    drop(registration);
    (result, *work)
}

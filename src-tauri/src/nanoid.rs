// A tiny, dependency-light nanoid: crypto-random bytes mapped onto the
// standard 64-character URL-safe alphabet (`A-Za-z0-9_-`), matching what the
// frontend's `nanoid` package (see `nanoid()` in src/state/AppStateContext.tsx)
// produces by default. This is a hand-rolled equivalent for the Rust core,
// which has no `nanoid` crate of its own — see storage.rs's `temp_path_for`
// for the one place that consumes it today.
//
// 64 divides 256 evenly, so masking each random byte down to its low 6 bits
// (`byte & 0x3F`) lands on every alphabet index with exactly equal
// probability. No modulo bias, no rejection sampling, no loops.
const ALPHABET: [u8; 64] =
    *b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

// The `nanoid` package's own default length, carried over here so IDs from
// either side of the IPC boundary look and behave the same.
pub const DEFAULT_LENGTH: usize = 21;

// Generates a `DEFAULT_LENGTH`-character crypto-random nanoid.
pub fn generate() -> Result<String, String> {
    generate_with_length(DEFAULT_LENGTH)
}

fn generate_with_length(length: usize) -> Result<String, String> {
    let mut bytes = vec![0u8; length];
    getrandom::fill(&mut bytes).map_err(|error| error.to_string())?;
    Ok(bytes
        .into_iter()
        .map(|byte| ALPHABET[(byte & 0x3F) as usize] as char)
        .collect())
}

#[cfg(test)]
// EXCEPTION to tests-folder conventions: the module is private to the crate, and the tests drive
// the private `generate_with_length` to pin lengths the public `generate` fixes.
#[path = "../tests/unit/nanoid.rs"]
mod tests;

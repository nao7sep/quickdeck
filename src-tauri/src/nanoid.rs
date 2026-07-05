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
mod tests {
    use super::*;

    #[test]
    fn generate_produces_default_length() {
        let id = generate().unwrap();
        assert_eq!(id.chars().count(), DEFAULT_LENGTH);
    }

    #[test]
    fn generate_with_length_honors_requested_length() {
        for length in [0, 1, 8, 64] {
            let id = generate_with_length(length).unwrap();
            assert_eq!(id.chars().count(), length);
        }
    }

    #[test]
    fn generate_only_uses_the_url_safe_alphabet() {
        let id = generate_with_length(256).unwrap();
        assert!(
            id.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'),
            "unexpected character in nanoid: {id}"
        );
        // Every alphabet character is ASCII, so char count and byte length agree.
        assert_eq!(id.len(), 256);
    }

    #[test]
    fn two_calls_differ() {
        // Astronomically unlikely to collide at 21 chars from a 64-symbol
        // alphabet (64^21 possibilities); a match here would indicate a broken
        // RNG source, not bad luck.
        assert_ne!(generate().unwrap(), generate().unwrap());
    }
}

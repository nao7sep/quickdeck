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

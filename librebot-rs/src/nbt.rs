//! Lecteur NBT minimal (tags 0-12) + extraction de texte des composants de chat.

pub enum Nbt {
    End,
    Byte(i8),
    Short(i16),
    Int(i32),
    Long(i64),
    Float(f32),
    Double(f64),
    ByteArray(Vec<u8>),
    String(String),
    List(Vec<Nbt>),
    Compound(Vec<(String, Nbt)>),
    IntArray(Vec<i32>),
    LongArray(Vec<i64>),
}

pub fn parse(buf: &mut &[u8]) -> Option<Nbt> {
    let tag = first(buf)?;
    value(buf, tag)
}

fn first(buf: &mut &[u8]) -> Option<u8> {
    if buf.is_empty() {
        return None;
    }
    let b = buf[0];
    *buf = &buf[1..];
    Some(b)
}

fn u16be(buf: &mut &[u8]) -> Option<u16> {
    if buf.len() < 2 {
        return None;
    }
    let v = u16::from_be_bytes([buf[0], buf[1]]);
    *buf = &buf[2..];
    Some(v)
}

fn string(buf: &mut &[u8]) -> Option<String> {
    let len = u16be(buf)? as usize;
    if buf.len() < len {
        return None;
    }
    let s = String::from_utf8_lossy(&buf[..len]).into_owned();
    *buf = &buf[len..];
    Some(s)
}

fn int(buf: &mut &[u8]) -> Option<i32> {
    if buf.len() < 4 {
        return None;
    }
    let v = i32::from_be_bytes([buf[0], buf[1], buf[2], buf[3]]);
    *buf = &buf[4..];
    Some(v)
}

fn value(buf: &mut &[u8], tag: u8) -> Option<Nbt> {
    Some(match tag {
        0 => Nbt::End,
        1 => Nbt::Byte(first(buf)? as i8),
        2 => {
            let v = u16be(buf)?;
            Nbt::Short(v as i16)
        }
        3 => Nbt::Int(int(buf)?),
        4 => {
            let v = int(buf)?;
            Nbt::Long(v as i64)
        }
        5 => Nbt::Float(f32::from_bits(int(buf)? as u32)),
        6 => Nbt::Double(f64::from_bits({
            if buf.len() < 8 {
                return None;
            }
            let mut b = [0u8; 8];
            b.copy_from_slice(&buf[..8]);
            *buf = &buf[8..];
            u64::from_be_bytes(b)
        })),
        7 => {
            let n = int(buf)? as usize;
            if buf.len() < n {
                return None;
            }
            let v = buf[..n].to_vec();
            *buf = &buf[n..];
            Nbt::ByteArray(v)
        }
        8 => Nbt::String(string(buf)?),
        9 => {
            let el = first(buf)?;
            let n = int(buf)? as usize;
            let mut items = Vec::with_capacity(n.min(1024));
            for _ in 0..n {
                items.push(value(buf, el)?);
            }
            Nbt::List(items)
        }
        10 => {
            let mut entries = Vec::new();
            loop {
                let t = first(buf)?;
                if t == 0 {
                    break;
                }
                let name = string(buf)?;
                let v = value(buf, t)?;
                entries.push((name, v));
            }
            Nbt::Compound(entries)
        }
        11 => {
            let n = int(buf)? as usize;
            let mut items = Vec::with_capacity(n.min(4096));
            for _ in 0..n {
                items.push(int(buf)?);
            }
            Nbt::IntArray(items)
        }
        12 => {
            let n = int(buf)? as usize;
            let mut items = Vec::with_capacity(n.min(4096));
            for _ in 0..n {
                if buf.len() < 8 {
                    return None;
                }
                let mut b = [0u8; 8];
                b.copy_from_slice(&buf[..8]);
                *buf = &buf[8..];
                items.push(i64::from_be_bytes(b));
            }
            Nbt::LongArray(items)
        }
        _ => return None,
    })
}

/// Extrait le texte affichable d'un composant de chat (text, extra, translate).
pub fn text(n: &Nbt) -> String {
    let mut out = String::new();
    collect(n, &mut out);
    out
}

fn collect(n: &Nbt, out: &mut String) {
    match n {
        Nbt::String(s) => out.push_str(s),
        Nbt::List(items) => {
            for i in items {
                collect(i, out);
            }
        }
        Nbt::Compound(entries) => {
            for (k, v) in entries {
                match k.as_str() {
                    "text" => collect(v, out),
                    "extra" => collect(v, out),
                    "translate" => {
                        if let Nbt::String(t) = v {
                            out.push_str(t);
                        }
                    }
                    _ => {}
                }
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn compound(text: &str) -> Vec<u8> {
        let mut b = vec![10u8];
        b.push(8);
        b.extend_from_slice(&4u16.to_be_bytes());
        b.extend_from_slice(b"text");
        b.extend_from_slice(&(text.len() as u16).to_be_bytes());
        b.extend_from_slice(text.as_bytes());
        b.push(0);
        b
    }

    #[test]
    fn parse_et_texte() {
        let mut buf: &[u8] = &compound("Bonjour");
        let n = parse(&mut buf).unwrap();
        assert_eq!(text(&n), "Bonjour");
    }
}

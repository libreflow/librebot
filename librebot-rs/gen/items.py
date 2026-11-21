#!/usr/bin/env python3
"""Génère src/items_gen.rs depuis minecraft-data (items.json 1.21.1).

Usage :
    git clone --depth 1 https://github.com/PrismarineJS/minecraft-data /tmp/mcd
    python3 gen/items.py /tmp/mcd
"""
import json
import sys

mc = sys.argv[1] if len(sys.argv) > 1 else "/tmp/mcd"
items = json.load(open(f"{mc}/data/pc/1.21.1/items.json"))

rows = [(it["id"], it["name"]) for it in items]
rows.sort()

TEMPLATE = '''//! Généré depuis minecraft-data (items.json 1.21.1).
//! Ne pas éditer à la main : relancer gen/items.py.

pub const MC_ITEMS: [(i32, &str); {n}] = [
{entries}
];

pub fn item_name(id: i32) -> &'static str {{
    MC_ITEMS[MC_ITEMS.partition_point(|r| r.0 <= id).saturating_sub(1)].1
}}

#[cfg(test)]
mod tests {{
    use super::*;

    #[test]
    fn items_connus() {{
        assert_eq!(item_name(0), "air");
        assert_eq!(item_name(1), "stone");
        assert!(item_name(300).len() > 2);
    }}
}}
'''

entries = "".join('    (%d, "%s"),\n' % (i, n) for i, n in rows)
with open("src/items_gen.rs", "w") as f:
    f.write(TEMPLATE.format(n=len(rows), entries=entries))
print(f"gen ok : {len(rows)} items")

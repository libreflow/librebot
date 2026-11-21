#!/usr/bin/env python3
"""Génère src/blocks_gen.rs depuis minecraft-data.

Usage :
    git clone --depth 1 https://github.com/PrismarineJS/minecraft-data /tmp/mcd
    python3 gen/blocks.py /tmp/mcd

Sources : data/pc/1.21.1/blocks.json (plages d'IDs d'état, dureté)
        + data/pc/1.21.3/blockCollisionShapes.json (solidité ; blocs stables entre versions).
"""
import json
import sys

mc = sys.argv[1] if len(sys.argv) > 1 else "/tmp/mcd"
sh = json.load(open(f"{mc}/data/pc/1.21.3/blockCollisionShapes.json"))["blocks"]
bl = json.load(open(f"{mc}/data/pc/1.21.1/blocks.json"))

rows = []
for b in bl:
    name = b["name"]
    shp = sh.get(name)
    solid = len(shp) > 0 if isinstance(shp, list) else bool(shp)
    if name in ("water", "lava"):
        solid = False
    hardness = b.get("hardness")
    hardness = -1.0 if hardness is None else float(hardness)
    rows.append((b["minStateId"], b["maxStateId"] + 1, name, solid, hardness))
rows.sort()

TEMPLATE = '''//! Généré depuis minecraft-data (blocks.json 1.21.1 + blockCollisionShapes.json 1.21.3).
//! Ne pas éditer à la main : relancer gen/blocks.py.

pub const MC_BLOCKS: [(u32, &str, bool, f32); {n}] = [
{entries}
];

/// Plages triées par état max exclusif ; la ligne i couvre les états < MC_BLOCKS[i].0.
fn index_of(state: u32) -> usize {{
    MC_BLOCKS
        .partition_point(|r| r.0 <= state)
        .min(MC_BLOCKS.len() - 1)
}}

pub fn block_name(state: u32) -> &'static str {{
    MC_BLOCKS[index_of(state)].1
}}

/// Un bloc est solide s'il a une hitbox de collision (shapes non vides).
pub fn is_solid(state: u32) -> bool {{
    MC_BLOCKS[index_of(state)].2
}}

/// Dureté ; négatif = incassable (bedrock, etc.).
pub fn hardness(state: u32) -> f64 {{
    MC_BLOCKS[index_of(state)].3 as f64
}}

/// Durée de minage estimée à mains nues (dureté * 1,5 s, plancher 50 ms).
pub fn break_time_secs(state: u32) -> f64 {{
    let h = hardness(state);
    if h < 0.0 {{
        f64::INFINITY
    }} else {{
        (h * 1.5).max(0.05)
    }}
}}

#[cfg(test)]
mod tests {{
    use super::*;

    #[test]
    fn solides_connus() {{
        assert_eq!(block_name(0), "air");
        assert!(!is_solid(0));
        assert_eq!(block_name(1), "stone");
        assert!(is_solid(1));
        assert!(break_time_secs(1) > 2.0);
        assert_eq!(block_name(9), "grass_block");
        assert!(is_solid(9));
        assert!(break_time_secs(0) < 0.1);
    }}
}}
'''

entries = "".join(
    '    (%d, "%s", %s, %s_f32),\n'
    % (mx, name, "true" if solid else "false", hardness)
    for _mn, mx, name, solid, hardness in rows
)
with open("src/blocks_gen.rs", "w") as f:
    f.write(TEMPLATE.format(n=len(rows), entries=entries))
print(f"gen ok : {len(rows)} plages, état max {rows[-1][1] - 1}")

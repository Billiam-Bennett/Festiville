# Make the character generator's parts from MakeHuman (MPFB) CC0 assets.
#
# Usage (Blender 5.2 with the MPFB extension and the CC0 asset packs loaded):
#   blender -b --python scripts/make-parts.py -- client/assets/parts
#   blender -b --python scripts/make-parts.py -- client/assets/parts --only hair=afro01   (one part, for testing)
#   blender -b --python scripts/make-parts.py -- client/assets/parts --keep-missing
# No Blender install? The `bpy` module works too: pip install bpy==5.2.3 (needs Python 3.13), copy MPFB's
# src/mpfb (github.com/makehumancommunity/mpfb2) to ~/.config/blender/5.2/extensions/blender_org/mpfb, then
#   python scripts/make-parts.py -- client/assets/parts --keep-missing
# --only exports just that part's files (body.glb, the hide masks and manifest.json are left alone).
# --keep-missing: a part whose asset pack isn't installed keeps its existing .glb, manifest entry and hide
#   bit (copied from the existing body.glb, whose vertices must line up with the new export; the script
#   checks), so new parts can be added without every pack on hand. Without it a missing asset is an error.
#
# For each body (female, male) it writes into <out>/<body>/:
#   body.glb          skinned body + eyes + eyelashes, MPFB's Mixamo skeleton (mixamorig* bones, same as the
#                     game's animations). Each clothing slot gets a per-vertex "hide mask" attribute
#                     (_hide_top, _hide_bottom, _hide_shoes, _hide_accessory): bit N set = the slot's Nth part
#                     covers this vertex, so the game hides that skin while the part is worn.
#                     It also carries the body SHAPES (builds and faces, see SHAPES) as morph targets,
#                     quantized (KHR_mesh_quantization) and sparse. The game bakes the chosen ones into the
#                     body and refits the parts to it (client/avatar.js), so each part is exported ONCE per
#                     body, not once per shape: a shape costs ~0.1-0.25 MB of body.glb instead of a full set of parts.
#   <partId>.glb      one hair, eyebrow, top, bottom, shoe or accessory, weighted to the same skeleton.
#   skins/<id>.webp   alternative skin textures for the body's material.
# and <out>/manifest.json listing every file plus each part's slot and hide bit, and each body's shapes.
#
# Textures are capped at TEX_MAX px and saved as WebP to keep downloads small. Hair and eyebrow textures
# are turned light grey so the game's hair colors tint them cleanly (shared/parts.js). Materials are
# written as alpha MASK (cut-out) rather than BLEND, so they sort and draw like solid surfaces in the
# game; the body's skin is fully OPAQUE. Every asset used here is CC0: MakeHuman's packs (system assets,
# hair01, shoes01, eyebrows01, shirts01, pants01, skirts01) and the MakeHuman 2 CC0 repository
# (github.com/Makehuman-2/MH2_Asset_Repository_CCO releases: mh_system_CC0.zip and crude_kit_CC0.zip;
# unzip the system pack into MPFB's user data folder and the crude kit into its clothes/ folder).
import bpy, sys, os, json, glob, struct, tempfile
import numpy as np
from mathutils import kdtree
from mathutils.bvhtree import BVHTree
from mathutils import Vector
try:
    from bl_ext.blender_org.mpfb.services import LocationService
except ImportError:   # running under the `bpy` Python module: enable MPFB (installed as a user extension) first
    import addon_utils
    addon_utils.enable("bl_ext.blender_org.mpfb", default_set=True)
    from bl_ext.blender_org.mpfb.services import LocationService
from bl_ext.blender_org.mpfb.services.humanservice import HumanService
from bl_ext.blender_org.mpfb.services.targetservice import TargetService

TEX_MAX = 1024
HAIR_CUTOFF = 0.35    # hair cards fade out at the tips; a low cutoff keeps them full
CLOTH_CUTOFF = 0.5

BODIES = {
    "female": {"gender": 0.0, "skin": "young_caucasian_female",
               "skins": ["young_caucasian_female", "young_asian_female", "young_african_female"]},
    "male":   {"gender": 1.0, "skin": "young_caucasian_male",
               "skins": ["young_caucasian_male", "young_asian_male", "young_african_male"]},
}

# Body shapes, stored in body.glb as morph targets named "<kind>_<id>" (ids match BUILDS / FACES in
# shared/parts.js). A build changes MPFB macros (0..1, 0.5 = average); a face loads MPFB targets on top.
# Shapes add to each other in the game (one build + one face), so keep faces to the head. MakeHuman's
# weight/muscle macros alone are subtle (max weight moves the skin ~2 cm), so builds add body targets.
# Avoid targets that move joints much (shoulder width, height, limb length): the skeleton stays the default's.
def both_sides(targets):
    return {f"{side}-{t}": v for t, v in targets.items() for side in ("l", "r")}


SHAPES = {
    "build_slim":     {"macros": {"weight": 0.0, "muscle": 0.4},
                       "targets": {"measure-waist-circ-decr": 0.5, "measure-hips-circ-decr": 0.3,
                                   **both_sides({"upperarm-fat-decr": 0.6, "upperleg-fat-decr": 0.6, "lowerleg-fat-decr": 0.4})}},
    "build_heavy":    {"macros": {"weight": 1.0},
                       "targets": {"stomach-pregnant-incr": 0.35, "measure-waist-circ-incr": 0.8, "measure-hips-circ-incr": 0.5,
                                   "buttocks-volume-incr": 0.5, "neck-double-incr": 0.6, "head-fat-incr": 0.4,
                                   "torso-scale-depth-incr": 0.3, "measure-bust-circ-incr": 0.3,
                                   **both_sides({"upperarm-fat-incr": 0.8, "lowerarm-fat-incr": 0.5,
                                                 "upperleg-fat-incr": 0.7, "lowerleg-fat-incr": 0.5})}},
    "build_athletic": {"macros": {"muscle": 1.0, "weight": 0.55},
                       "targets": {"torso-vshape-incr": 0.6, "torso-muscle-pectoral-incr": 0.4, "torso-muscle-dorsi-incr": 0.5,
                                   "stomach-tone-incr": 0.6, "measure-waist-circ-decr": 0.3,
                                   **both_sides({"upperarm-muscle-incr": 0.7, "lowerarm-muscle-incr": 0.5,
                                                 "upperarm-shoulder-muscle-incr": 0.5, "upperleg-muscle-incr": 0.5,
                                                 "lowerleg-muscle-incr": 0.5})}},
    "face_round":     {"targets": {"head-round": 0.8, "head-fat-incr": 0.6, "nose-scale-horiz-incr": 0.4,
                                   "nose-point-up": 0.4, "mouth-lowerlip-volume-incr": 0.4, "chin-height-decr": 0.4}},
    "face_angular":   {"targets": {"head-square": 0.8, "chin-prominent-incr": 0.6, "chin-width-incr": 0.6,
                                   "nose-scale-vert-incr": 0.5, "nose-hump-incr": 0.6, "forehead-trans-backward": 0.3}},
    "face_heart":     {"targets": {"head-invertedtriangular": 0.8, "chin-height-incr": 0.3, "nose-scale-horiz-decr": 0.5,
                                   "nose-point-width-decr": 0.5, "mouth-scale-horiz-decr": 0.3,
                                   "l-eye-scale-incr": 0.4, "r-eye-scale-incr": 0.4}},
}

# slot -> parts. An entry is an MPFB asset folder name, or (file name, asset, "upper"|"lower") for one half
# of a one-piece system outfit: its loose pieces are split at the hips and only that half is kept.
# Order matters for clothing slots: position = hide bit (max 24 per slot), so only ever ADD to the end.
PARTS = {
    "hair": ["afro01", "bob01", "braid01", "long01", "ponytail01", "short01", "short02", "short04",
             "cortu_short_messy_hair", "elvs_french_braid_variation", "rehmanpolanski_hair_bun_brown",
             "sonntag78_blond_with_headband"],
    "eyebrows": ["eyebrow001", "eyebrow006", "eyebrow010"],
    "top": ["toigo_keyhole_tank_top", "toigo_camisole_top", "skalldyrssuppe_tube_top_funky_colors",
            "toigo_turtleneck_halter_top", "toigo_basic_tucked_t-shirt", "elvs_crude_t-shirt_male",
            "joepal_crude_t-shirt_female", "namuhekam_male_polo_shirt", "toigo_fisherman_sweater",
            ("puffer_jacket", "male_casualsuit05", "upper"), ("striped_shirt", "male_casualsuit03", "upper"),
            ("logo_longsleeve", "male_casualsuit02", "upper"), ("logo_tee", "female_casualsuit01", "upper"),
            ("suit_jacket", "male_elegantsuit01", "upper"),
            ("sport_crop", "female_sportsuit01", "upper"), "crude_lab_coat_open_female", "male_crude_labcoat"],
    "bottom": ["cortu_jeans_shorts", "cortu_cargo_pants", "toigo_harem_pants", "toigo_wool_pants",
               "frankyaye_mini_skirt_01", "toigo_tiered_mini_skirt", "toigo_long_full_skirt",
               ("jeans", "male_casualsuit04", "lower"), ("pencil_skirt", "female_elegantsuit01", "lower"),
               ("leggings", "female_sportsuit01", "lower"), ("belted_shorts", "female_casualsuit02", "lower")],
    "shoes": ["shoes01", "shoes02", "shoes03", "shoes04", "shoes05", "shoes06", "toigo_ankle_boots_female",
              "toigo_ankle_boots_male", "scailman_gogo_platform_boots", "toigo_flats", "culturalibre_male_boots"],
    "accessory": ["fedora01", "fedora_cocked", "crude_hat", "crude_lab_glasses", "crude_theater_mask",
                  "crude_gloves", "crude_long_gloves"],
}
# Open garments (worn without a shirt here): hide only the skin right under the cloth, not everything the
# asset's delete group marks (a lab coat expects a shirt and would otherwise leave a hole down the front).
NEAR_ONLY = {"crude_lab_coat_open_female": 0.02, "male_crude_labcoat": 0.02}   # file -> max distance (m)
CLOTHING_SLOTS = ("top", "bottom", "shoes", "accessory")   # get hide masks; must match HIDE_SLOTS in client/avatar.js
ASSET_DIR = {"hair": "hair", "eyebrows": "eyebrows"}       # everything else is in clothes/
ASSET_TYPE = {"hair": "Hair", "eyebrows": "Eyebrows"}      # everything else is "Clothes"

args = sys.argv[sys.argv.index("--") + 1:]
out_root = os.path.abspath(args[0])
only = None
if "--only" in args:
    slot, name = args[args.index("--only") + 1].split("=")
    only = (slot, name)
keep_missing = "--keep-missing" in args
data = LocationService.get_user_data()


def entry_names(e):
    """PARTS entry -> (exported file name, MPFB asset folder, piece or None)."""
    return (e, e, None) if isinstance(e, str) else e


def asset_file(subdir, name, ext, missing_ok=False):
    hits = glob.glob(os.path.join(data, subdir, name, "*." + ext))
    if not hits:
        if missing_ok:
            return None
        raise FileNotFoundError(f"{subdir}/{name}/*.{ext} not found — is its asset pack loaded in MPFB? "
                                "(--keep-missing keeps the already exported file instead)")
    return hits[0]


def shrink_images():
    for img in bpy.data.images:
        w, h = img.size
        if max(w, h) > TEX_MAX:
            s = TEX_MAX / max(w, h)
            img.scale(max(1, int(w * s)), max(1, int(h * s)))


def strip_subdivision(obj):
    for m in list(obj.modifiers):
        if m.type == "SUBSURF":
            obj.modifiers.remove(m)


def greyscale_textures(obj):
    """Turn the base color textures of obj's materials into light grey (keeping alpha), for tinting."""
    for slot in obj.material_slots:
        if not slot.material or not slot.material.use_nodes:
            continue
        for node in slot.material.node_tree.nodes:
            img = getattr(node, "image", None)
            if node.type != "TEX_IMAGE" or not img or img.get("fv_grey") or img.colorspace_settings.name != "sRGB":
                continue
            px = np.empty(len(img.pixels), dtype=np.float32)
            img.pixels.foreach_get(px)
            px = px.reshape(-1, 4)
            lum = px[:, 0] * 0.2126 + px[:, 1] * 0.7152 + px[:, 2] * 0.0722
            seen = px[:, 3] > 0.1
            lo, hi = np.percentile(lum[seen], [2, 98]) if seen.any() else (0.0, 1.0)
            grey = 0.45 + 0.55 * np.clip((lum - lo) / max(hi - lo, 1e-3), 0, 1)   # keep strand detail, stay light
            px[:, 0] = px[:, 1] = px[:, 2] = grey
            img.pixels.foreach_set(px.ravel())
            img["fv_grey"] = True


# ---------- .glb read/write (just enough for post-processing what Blender exported) ----------
COMP = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def read_glb(path):
    with open(path, "rb") as f:
        b = f.read()
    json_len = struct.unpack_from("<I", b, 12)[0]
    j = json.loads(b[20:20 + json_len])
    rest = b[20 + json_len:]
    binary = bytearray(rest[8:8 + struct.unpack_from("<I", rest, 0)[0]]) if len(rest) >= 8 else bytearray()
    return j, binary


def write_glb(path, j, binary):
    while len(binary) % 4:
        binary.append(0)
    if j.get("buffers"):
        j["buffers"][0]["byteLength"] = len(binary)
    js = json.dumps(j, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    chunks = struct.pack("<I", len(js)) + b"JSON" + js
    if binary:
        chunks += struct.pack("<I", len(binary)) + b"BIN\x00" + bytes(binary)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 12 + len(chunks)) + chunks)


def accessor_view(j, binary, i):
    """A writable numpy view of a dense, tightly packed accessor (what Blender writes)."""
    a = j["accessors"][i]
    bv = j["bufferViews"][a["bufferView"]]
    dt, n = COMP[a["componentType"]], WIDTH[a["type"]]
    assert not bv.get("byteStride") or bv["byteStride"] == n * np.dtype(dt).itemsize, "interleaved accessor"
    start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    return np.frombuffer(binary, dtype=dt, count=a["count"] * n, offset=start).reshape(-1, n)


def add_buffer_view(j, binary, array):
    while len(binary) % 4:
        binary.append(0)
    raw = np.ascontiguousarray(array).tobytes()
    j["bufferViews"].append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(raw)})
    binary.extend(raw)
    return len(j["bufferViews"]) - 1


def set_alpha_modes(path, mode_for):
    """Rewrite each material's alphaMode in a .glb. mode_for(material_name) -> ("OPAQUE"|"MASK", cutoff)."""
    j, binary = read_glb(path)
    for m in j.get("materials", []):
        mode, cutoff = mode_for(m.get("name", ""))
        m["alphaMode"] = mode
        m.pop("alphaCutoff", None)
        if mode == "MASK":
            m["alphaCutoff"] = cutoff
    write_glb(path, j, binary)


def body_alpha(name):
    if name.endswith(".body"):
        return "OPAQUE", None
    return "MASK", HAIR_CUTOFF    # eyelashes, eyes


def mesh_attribute(j, binary, mesh_index, name):
    prim = j["meshes"][mesh_index]["primitives"]
    assert len(prim) == 1, "one primitive per mesh expected"
    a = prim[0]["attributes"].get(name)
    return None if a is None else accessor_view(j, binary, a)


def add_shapes(path, shape_files):
    """Add each shape's export (same human, other macros/targets) to body.glb as sparse, quantized morph
    targets: POSITION deltas as normalized int16 (1/32767 m steps), NORMAL deltas as normalized int8."""
    j, binary = read_glb(path)
    base = [(mesh_attribute(j, binary, i, "POSITION").copy(), mesh_attribute(j, binary, i, "NORMAL").copy())
            for i in range(len(j["meshes"]))]
    targets = [[] for _ in j["meshes"]]
    sizes = {}
    for name, file in shape_files:
        sj, sbin = read_glb(file)
        assert [m.get("name") for m in sj["meshes"]] == [m.get("name") for m in j["meshes"]], "mesh list differs"
        before = len(binary)
        for i, (pos, nrm) in enumerate(base):
            spos, snrm = mesh_attribute(sj, sbin, i, "POSITION"), mesh_attribute(sj, sbin, i, "NORMAL")
            assert spos.shape == pos.shape, f"{name}: vertex count differs on mesh {i}"
            target = {}
            for attr, delta, scale, ctype, dtype in (("POSITION", spos - pos, 32767, 5122, np.int16),
                                                     ("NORMAL", snrm - nrm, 127, 5120, np.int8)):
                assert attr == "NORMAL" or np.abs(delta).max() < 1, f"{name}: shape moves a vertex over 1 m"
                q = np.clip(np.round(delta * scale), -scale, scale).astype(dtype)
                idx = np.nonzero(np.abs(q).max(axis=1) > 0)[0].astype(np.uint16 if len(pos) < 65536 else np.uint32)
                acc = {"componentType": ctype, "normalized": True, "count": len(pos), "type": "VEC3"}
                if attr == "POSITION":   # required for POSITION; in the stored (integer) units
                    acc["min"] = [int(v) for v in (q.min(axis=0) if len(q) else [0, 0, 0])]
                    acc["max"] = [int(v) for v in (q.max(axis=0) if len(q) else [0, 0, 0])]
                if len(idx):
                    acc["sparse"] = {"count": int(len(idx)),
                                     "indices": {"bufferView": add_buffer_view(j, binary, idx),
                                                 "componentType": 5123 if idx.dtype == np.uint16 else 5125},
                                     "values": {"bufferView": add_buffer_view(j, binary, q[idx])}}
                j["accessors"].append(acc)
                target[attr] = len(j["accessors"]) - 1
            targets[i].append(target)
        sizes[name] = len(binary) - before
    for mesh, t in zip(j["meshes"], targets):
        mesh["primitives"][0]["targets"] = t
        mesh["weights"] = [0.0] * len(t)
        mesh.setdefault("extras", {})["targetNames"] = [n for n, _ in shape_files]
    for key in ("extensionsUsed", "extensionsRequired"):
        j[key] = sorted(set(j.get(key, [])) | {"KHR_mesh_quantization"})
    write_glb(path, j, binary)
    return sizes


def keep_old_bits(path, old, keep):
    """Copy the hide bits of parts that weren't re-made (keep: {slot: bitmask}) from the old body.glb."""
    j, binary = read_glb(path)
    oj, obin = old
    for i in range(len(j["meshes"])):
        pos, opos = mesh_attribute(j, binary, i, "POSITION"), mesh_attribute(oj, obin, i, "POSITION")
        for slot, mask in keep.items():
            new, was = mesh_attribute(j, binary, i, "_HIDE_" + slot.upper()), mesh_attribute(oj, obin, i, "_HIDE_" + slot.upper())
            if new is None or was is None or not mask:
                continue
            if pos.shape != opos.shape or np.abs(pos - opos).max() > 1e-5:
                raise RuntimeError("--keep-missing: the new body doesn't line up with the old body.glb, "
                                   "so the old hide masks can't be reused. Install the missing packs instead.")
            merged = (new.astype(np.int64) & ~mask) | (was.astype(np.int64) & mask)
            new[:] = merged.astype(new.dtype)
    write_glb(path, j, binary)


# ---------- Building the human ----------
def make_human(cfg, macros=None, targets=None):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    m = TargetService.get_default_macro_info_dict()
    m["gender"] = cfg["gender"]
    m.update(macros or {})
    basemesh = HumanService.create_human(macro_detail_dict=m)
    if targets:
        TargetService.bulk_load_targets(basemesh, [{"target": t, "value": v} for t, v in targets.items()])
    rig = HumanService.add_builtin_rig(basemesh, "mixamo")
    HumanService.set_character_skin(asset_file("skins", cfg["skin"], "mhmat"), basemesh, skin_type="GAMEENGINE")
    eyes = HumanService.add_mhclo_asset(asset_file("eyes", "low-poly", "mhclo"), basemesh, asset_type="Eyes",
                                        material_type="GAMEENGINE")
    lashes = HumanService.add_mhclo_asset(asset_file("eyelashes", "eyelashes01", "mhclo"), basemesh,
                                          asset_type="Eyelashes", material_type="GAMEENGINE")
    for o in (eyes, lashes):
        strip_subdivision(o)
    return rig, basemesh, eyes, lashes


def body_coords(basemesh):
    """The body's vertex positions with its shape keys (the macros) mixed in, in world space."""
    mesh = basemesh.data
    co = np.empty(len(mesh.vertices) * 3, dtype=np.float64)
    mesh.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    if mesh.shape_keys:
        basis = mesh.shape_keys.reference_key
        for kb in mesh.shape_keys.key_blocks:
            if kb == basis or kb.value == 0:
                continue
            k = np.empty(len(mesh.vertices) * 3)
            r = np.empty(len(mesh.vertices) * 3)
            kb.data.foreach_get("co", k)
            kb.relative_key.data.foreach_get("co", r)
            co += kb.value * (k - r).reshape(-1, 3)
    mw = np.array(basemesh.matrix_world)
    return co @ mw[:3, :3].T + mw[:3, 3]


def hips_height(rig):
    hips = next(b for b in rig.pose.bones if b.name.endswith("Hips"))
    return (rig.matrix_world @ hips.head).z


def loose_pieces(obj):
    """[(vertex indices, mean world z)] for each connected piece of obj's mesh."""
    mesh = obj.data
    parent = np.arange(len(mesh.vertices))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    ev = np.empty(len(mesh.edges) * 2, dtype=np.int64)
    mesh.edges.foreach_get("vertices", ev)
    for a, b in ev.reshape(-1, 2):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    roots = np.array([find(i) for i in range(len(parent))])
    co = np.array([obj.matrix_world @ v.co for v in mesh.vertices])
    return [(np.nonzero(roots == r)[0], co[roots == r, 2].mean()) for r in np.unique(roots)], co


def split_outfit(obj, piece, split_z):
    """Keep only the upper or lower half (by loose piece, at split_z) of a one-piece outfit. Returns
    (kept coords, dropped coords) in world space."""
    pieces, co = loose_pieces(obj)
    keep = np.zeros(len(co), dtype=bool)
    for idx, z in pieces:
        if (z >= split_z) == (piece == "upper"):
            keep[idx] = True
    if not keep.any() or keep.all():
        raise RuntimeError(f"{obj.name}: splitting at the hips left nothing to split ({len(pieces)} pieces)")
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in np.nonzero(~keep)[0]], context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return co[keep], co[~keep]


def kd(points):
    t = kdtree.KDTree(len(points))
    for i, p in enumerate(points):
        t.insert(p, i)
    t.balance()
    return t


def add_part(slot, asset, basemesh):
    return HumanService.add_mhclo_asset(asset_file(ASSET_DIR.get(slot, "clothes"), asset, "mhclo"), basemesh,
                                        asset_type=ASSET_TYPE.get(slot, "Clothes"), material_type="GAMEENGINE")


def export(objects, path):
    shrink_images()
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                              export_skins=True, export_animations=False, export_morph=False,
                              export_attributes=True, export_image_format="WEBP")
    return os.path.getsize(path)


manifest_path = os.path.join(out_root, "manifest.json")
old_manifest = {}
if os.path.isfile(manifest_path):
    with open(manifest_path, encoding="utf-8") as f:
        old_manifest = json.load(f)
manifest = {"skeleton": "mixamo", "texMax": TEX_MAX, "bodies": {}}

for body, cfg in BODIES.items():
    out = os.path.join(out_root, body)
    os.makedirs(os.path.join(out, "skins"), exist_ok=True)
    rig, basemesh, eyes, lashes = make_human(cfg)
    split_z = hips_height(rig)
    old_parts = old_manifest.get("bodies", {}).get(body, {}).get("parts", {})
    info = {"body": "body.glb", "skins": {}, "shapes": list(SHAPES), "parts": {}}
    mesh = basemesh.data
    missing = {}   # file name -> slot, for parts whose asset isn't installed (--keep-missing)

    def available(slot, file, asset):
        if asset_file(ASSET_DIR.get(slot, "clothes"), asset, "mhclo", missing_ok=keep_missing):
            return True
        if file not in old_parts or not os.path.isfile(os.path.join(out, file + ".glb")):
            raise FileNotFoundError(f"{asset}: not installed, and there's no earlier export of {file} to keep")
        missing[file] = slot
        return False

    if not only:
        # Hide masks: fit every clothing part once just to read the body area it covers, then drop it.
        # A split outfit only claims the covered skin that's closer to the half it keeps.
        masks = {slot: np.zeros(len(mesh.vertices), dtype=np.int64) for slot in CLOTHING_SLOTS}
        coords = body_coords(basemesh)
        for slot in CLOTHING_SLOTS:
            for bit, e in enumerate(PARTS[slot]):
                file, asset, piece = entry_names(e)
                if not available(slot, file, asset):
                    continue
                part = add_part(slot, asset, basemesh)
                kept_dropped = split_outfit(part, piece, split_z) if piece else None
                group = basemesh.vertex_groups.get("Delete." + os.path.basename(asset_file("clothes", asset, "mhclo"))
                                                   .replace(".mhclo", "").replace(" ", "_"))
                if group:
                    gi = group.index
                    covered = [v.index for v in mesh.vertices if any(g.group == gi and g.weight > 0.5 for g in v.groups)]
                    if kept_dropped:
                        tk, td = kd(kept_dropped[0]), kd(kept_dropped[1])
                        covered = [i for i in covered if tk.find(coords[i])[2] <= td.find(coords[i])[2]]
                    if file in NEAR_ONLY:
                        dg = bpy.context.evaluated_depsgraph_get()
                        tree = BVHTree.FromObject(part, dg)   # in the part's local space
                        inv = part.matrix_world.inverted()
                        near = lambda i: tree.find_nearest(inv @ Vector(coords[i]), NEAR_ONLY[file])[0] is not None
                        covered = [i for i in covered if near(i)]
                    masks[slot][covered] |= 1 << bit
                    basemesh.vertex_groups.remove(group)
                bpy.data.objects.remove(part, do_unlink=True)
        for slot, values in masks.items():
            attr = mesh.attributes.new("_hide_" + slot, "FLOAT", "POINT")
            attr.data.foreach_set("value", values.astype(np.float32))

        body_path = os.path.join(out, "body.glb")
        old_body = read_glb(body_path) if missing and os.path.isfile(body_path) else None
        size = export([rig, basemesh, eyes, lashes], body_path)
        set_alpha_modes(body_path, body_alpha)
        if missing:
            if not old_body:
                raise FileNotFoundError(f"--keep-missing needs the earlier {body_path} to copy hide masks from")
            keep = {}
            for file, slot in missing.items():
                if slot in CLOTHING_SLOTS:
                    keep[slot] = keep.get(slot, 0) | (1 << old_parts[file]["hideBit"])
            keep_old_bits(body_path, old_body, keep)
            print(f"KEPT {body}: hide bits of {len(missing)} parts that aren't installed: {sorted(missing)}")
        print(f"PART {body}/body.glb {size / 1e6:.2f}MB (before shapes)")

        # Alternative skin textures: the diffuse map of each skin, shrunk and saved as WebP.
        for skin in cfg["skins"]:
            mhmat = asset_file("skins", skin, "mhmat")
            diffuse = None
            with open(mhmat, encoding="utf-8") as f:
                for line in f:
                    if line.startswith("diffuseTexture"):
                        diffuse = os.path.join(os.path.dirname(mhmat), line.split(None, 1)[1].strip())
            if diffuse and os.path.isfile(diffuse):
                img = bpy.data.images.load(diffuse)
                img.scale(TEX_MAX, TEX_MAX)
                img.filepath_raw = os.path.join(out, "skins", skin + ".webp")
                img.file_format = "WEBP"
                img.save()
                info["skins"][skin] = f"skins/{skin}.webp"

    # Each part on its own, weighted to the shared skeleton.
    for slot, entries in PARTS.items():
        for bit, e in enumerate(entries):
            file, asset, piece = entry_names(e)
            if only and only != (slot, file):
                continue
            entry = {"slot": slot, "file": file + ".glb"}
            if slot in CLOTHING_SLOTS:
                entry["hideBit"] = bit
            info["parts"][file] = entry
            if file in missing or not available(slot, file, asset):
                continue
            part = add_part(slot, asset, basemesh)
            strip_subdivision(part)
            if piece:
                split_outfit(part, piece, split_z)
            hairy = slot in ("hair", "eyebrows")
            if hairy:
                greyscale_textures(part)
            size = export([rig, part], os.path.join(out, file + ".glb"))
            cutoff = HAIR_CUTOFF if hairy else CLOTH_CUTOFF
            set_alpha_modes(os.path.join(out, file + ".glb"), lambda _n: ("MASK", cutoff))
            print(f"PART {body}/{file}.glb {size / 1e6:.2f}MB")
            bpy.data.objects.remove(part, do_unlink=True)

    if not only:
        # Body shapes: the same human with other macros / targets, exported to a temporary file each and
        # stored in body.glb as morph targets (deltas from the default body; same vertex order).
        tmp = tempfile.mkdtemp(prefix="fv-shapes-")
        shape_files = []
        for name, shape in SHAPES.items():
            objs = make_human(cfg, shape.get("macros"), shape.get("targets"))
            shape_files.append((name, os.path.join(tmp, name + ".glb")))
            export(list(objs), shape_files[-1][1])
        sizes = add_shapes(os.path.join(out, "body.glb"), shape_files)
        for name, n in sizes.items():
            print(f"SHAPE {body}/{name} +{n / 1e6:.2f}MB")
        print(f"PART {body}/body.glb {os.path.getsize(os.path.join(out, 'body.glb')) / 1e6:.2f}MB (with shapes)")

    manifest["bodies"][body] = info

if not only:
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    print("Saved", manifest_path)

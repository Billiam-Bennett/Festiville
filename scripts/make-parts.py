# Make the character generator's parts from MakeHuman (MPFB) CC0 assets.
#
# Usage (Blender 5.2 with the MPFB extension and the CC0 asset packs loaded):
#   blender -b --python scripts/make-parts.py -- client/assets/parts
#   blender -b --python scripts/make-parts.py -- client/assets/parts --only hair=afro01   (one part, for testing)
#
# For each body (female, male) it writes into <out>/<body>/:
#   body.glb          skinned body + eyes + eyelashes, MPFB's Mixamo skeleton (mixamorig* bones, same as the
#                     game's animations). Each clothing slot gets a per-vertex "hide mask" attribute
#                     (_hide_top, _hide_bottom, _hide_shoes): bit N set = the slot's Nth part covers this vertex,
#                     so the game hides that skin while the part is worn (stops the body poking through).
#   <partId>.glb      one hair, eyebrow, top, bottom or shoe, weighted to the same skeleton.
#   skins/<id>.webp   alternative skin textures for the body's material.
# and <out>/manifest.json listing every file plus each part's slot and hide bit.
#
# Textures are capped at TEX_MAX px and saved as WebP to keep downloads small. Hair and eyebrow textures
# are turned light grey so the game's hair colors tint them cleanly (shared/parts.js). Materials are
# written as alpha MASK (cut-out) rather than BLEND, so they sort and draw like solid surfaces in the
# game; the body's skin is fully OPAQUE. Every asset used here comes from MakeHuman's CC0 packs
# (system assets, hair01, shoes01, eyebrows01, shirts01, pants01, skirts01).
import bpy, sys, os, json, glob, struct
import numpy as np
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

# slot -> MPFB asset folder names. Order matters for clothing slots: position = hide bit (max 24 per slot).
PARTS = {
    "hair": ["afro01", "bob01", "braid01", "long01", "ponytail01", "short01", "short02", "short04",
             "cortu_short_messy_hair", "elvs_french_braid_variation", "rehmanpolanski_hair_bun_brown",
             "sonntag78_blond_with_headband"],
    "eyebrows": ["eyebrow001", "eyebrow006", "eyebrow010"],
    "top": ["toigo_keyhole_tank_top", "toigo_camisole_top", "skalldyrssuppe_tube_top_funky_colors",
            "toigo_turtleneck_halter_top", "toigo_basic_tucked_t-shirt", "elvs_crude_t-shirt_male",
            "joepal_crude_t-shirt_female", "namuhekam_male_polo_shirt", "toigo_fisherman_sweater"],
    "bottom": ["cortu_jeans_shorts", "cortu_cargo_pants", "toigo_harem_pants", "toigo_wool_pants",
               "frankyaye_mini_skirt_01", "toigo_tiered_mini_skirt", "toigo_long_full_skirt"],
    "shoes": ["shoes01", "shoes02", "shoes03", "shoes04", "shoes05", "shoes06", "toigo_ankle_boots_female",
              "toigo_ankle_boots_male", "scailman_gogo_platform_boots", "toigo_flats", "culturalibre_male_boots"],
}
CLOTHING_SLOTS = ("top", "bottom", "shoes")
ASSET_DIR = {"hair": "hair", "eyebrows": "eyebrows", "top": "clothes", "bottom": "clothes", "shoes": "clothes"}
ASSET_TYPE = {"hair": "Hair", "eyebrows": "Eyebrows", "top": "Clothes", "bottom": "Clothes", "shoes": "Clothes"}

args = sys.argv[sys.argv.index("--") + 1:]
out_root = os.path.abspath(args[0])
only = None
if "--only" in args:
    slot, name = args[args.index("--only") + 1].split("=")
    only = (slot, name)
data = LocationService.get_user_data()


def asset_file(subdir, name, ext):
    hits = glob.glob(os.path.join(data, subdir, name, "*." + ext))
    if not hits:
        raise FileNotFoundError(f"{subdir}/{name}/*.{ext} not found — is its asset pack loaded in MPFB?")
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


def set_alpha_modes(path, mode_for):
    """Rewrite each material's alphaMode in a .glb. mode_for(material_name) -> ("OPAQUE"|"MASK", cutoff)."""
    with open(path, "rb") as f:
        b = f.read()
    json_len = struct.unpack_from("<I", b, 12)[0]
    j = json.loads(b[20:20 + json_len])
    for m in j.get("materials", []):
        mode, cutoff = mode_for(m.get("name", ""))
        m["alphaMode"] = mode
        m.pop("alphaCutoff", None)
        if mode == "MASK":
            m["alphaCutoff"] = cutoff
    js = json.dumps(j, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    rest = b[20 + json_len:]
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + len(rest)))
        f.write(struct.pack("<I", len(js)) + b"JSON" + js + rest)


def body_alpha(name):
    if name.endswith(".body"):
        return "OPAQUE", None
    return "MASK", HAIR_CUTOFF    # eyelashes, eyes


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


manifest = {"skeleton": "mixamo", "texMax": TEX_MAX, "bodies": {}}

for body, cfg in BODIES.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    out = os.path.join(out_root, body)
    os.makedirs(os.path.join(out, "skins"), exist_ok=True)

    macros = TargetService.get_default_macro_info_dict()
    macros["gender"] = cfg["gender"]
    basemesh = HumanService.create_human(macro_detail_dict=macros)
    rig = HumanService.add_builtin_rig(basemesh, "mixamo")
    HumanService.set_character_skin(asset_file("skins", cfg["skin"], "mhmat"), basemesh, skin_type="GAMEENGINE")
    eyes = HumanService.add_mhclo_asset(asset_file("eyes", "low-poly", "mhclo"), basemesh, asset_type="Eyes",
                                        material_type="GAMEENGINE")
    lashes = HumanService.add_mhclo_asset(asset_file("eyelashes", "eyelashes01", "mhclo"), basemesh,
                                          asset_type="Eyelashes", material_type="GAMEENGINE")
    for o in (eyes, lashes):
        strip_subdivision(o)

    info = {"body": "body.glb", "skins": {}, "parts": {}}
    mesh = basemesh.data

    # Hide masks: fit every clothing part once just to read the body area it covers, then drop it.
    masks = {slot: [0] * len(mesh.vertices) for slot in CLOTHING_SLOTS}
    for slot in CLOTHING_SLOTS:
        for bit, name in enumerate(PARTS[slot]):
            if only and only != (slot, name):
                continue
            part = HumanService.add_mhclo_asset(asset_file("clothes", name, "mhclo"), basemesh,
                                                asset_type="Clothes", material_type="GAMEENGINE")
            group = basemesh.vertex_groups.get("Delete." + os.path.basename(asset_file("clothes", name, "mhclo"))
                                               .replace(".mhclo", "").replace(" ", "_"))
            if group:
                gi = group.index
                for v in mesh.vertices:
                    if any(g.group == gi and g.weight > 0.5 for g in v.groups):
                        masks[slot][v.index] |= 1 << bit
                basemesh.vertex_groups.remove(group)
            bpy.data.objects.remove(part, do_unlink=True)
    for slot, values in masks.items():
        attr = mesh.attributes.new("_hide_" + slot, "FLOAT", "POINT")
        attr.data.foreach_set("value", [float(v) for v in values])

    size = export([rig, basemesh, eyes, lashes], os.path.join(out, "body.glb"))
    set_alpha_modes(os.path.join(out, "body.glb"), body_alpha)
    print(f"PART {body}/body.glb {size / 1e6:.2f}MB")

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
    for slot, names in PARTS.items():
        for bit, name in enumerate(names):
            if only and only != (slot, name):
                continue
            part = HumanService.add_mhclo_asset(asset_file(ASSET_DIR[slot], name, "mhclo"), basemesh,
                                                asset_type=ASSET_TYPE[slot], material_type="GAMEENGINE")
            strip_subdivision(part)
            hairy = slot in ("hair", "eyebrows")
            if hairy:
                greyscale_textures(part)
            size = export([rig, part], os.path.join(out, name + ".glb"))
            cutoff = HAIR_CUTOFF if hairy else CLOTH_CUTOFF
            set_alpha_modes(os.path.join(out, name + ".glb"), lambda _n: ("MASK", cutoff))
            entry = {"slot": slot, "file": name + ".glb"}
            if slot in CLOTHING_SLOTS:
                entry["hideBit"] = bit
            info["parts"][name] = entry
            print(f"PART {body}/{name}.glb {size / 1e6:.2f}MB")
            bpy.data.objects.remove(part, do_unlink=True)

    manifest["bodies"][body] = info

if not only:
    with open(os.path.join(out_root, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    print("Saved", os.path.join(out_root, "manifest.json"))

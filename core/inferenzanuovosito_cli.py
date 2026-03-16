#!/usr/bin/env python
"""
inferenzanuovosito_cli.py - Pipeline Completa MaskDINO Solar Panels (v5)
=========================================================================
CLI compatibile con il server FastAPI. Accetta:
  --tif     Percorso ortomosaico .tif
  --tfw     Percorso file .tfw di georeferenziazione
  --outdir  Cartella di output
  --weights Cartella contenente model_best.pth
"""

import argparse
import os
import sys
import glob

# Aggiungi path locali per detectron2 e maskdino se non installati globalmente
_BASE = os.path.dirname(os.path.abspath(__file__))
for _lib in ["libs/detectron2", "libs/maskdino", "libs"]:
    _p = os.path.join(_BASE, _lib)
    if os.path.isdir(_p) and _p not in sys.path:
        sys.path.insert(0, _p)
import re
import math
import warnings
import json
import zipfile
import cv2
import torch
import numpy as np
import rasterio
import simplekml
import pandas as pd
import geopandas as gpd
from shapely.geometry import Point, Polygon
from pyproj import Transformer

os.environ["OPENCV_LOG_LEVEL"] = "ERROR"
warnings.filterwarnings("ignore")

from detectron2.config import get_cfg
from detectron2.engine import DefaultPredictor
from detectron2.layers import nms

try:
    from maskdino import add_maskdino_config
except ImportError:
    print("❌ Errore: 'maskdino' non trovata. Esegui dalla root del progetto.")
    sys.exit(1)

# ==============================================================================
# ⚙️ CONFIGURAZIONE
# ==============================================================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

YAML_CONFIG       = os.path.join(BASE_DIR, "tesi_config.yaml")
NUM_CLASSES       = 1
SOGLIA_DETECTION  = 0.50
NMS_THRESH        = 0.40
MERGE_DIST_METERS = 1.0
DOT_RADIUS_MOSAIC = 8
BOOST             = 2.5
SCORE_MIN_EXPORT  = 0.5
TILE_SIZE         = 800
OVERLAP           = 0.70

CLASS_COLORS = {
    0: (0, 200, 0),
    1: (0, 0, 255),
    2: (0, 140, 255),
}
CLASS_NAMES = {0: "PV_Module", 1: "Hotspot", 2: "Degrado"}

# ==============================================================================
# ✂️ FASE 1: TAGLIO
# ==============================================================================

def taglio_tile(image_path, output_dir, tile_size=800, overlap=0.70):
    print(f"\n✂️  FASE 1: Taglio ortomosaico in tile...")
    if not os.path.exists(image_path):
        print(f"❌ ERRORE: Ortomosaico {image_path} non trovato!")
        return 0
    full_img = cv2.imread(image_path)
    if full_img is None:
        print(f"❌ ERRORE: Impossibile leggere {image_path}")
        return 0
    h_orig, w_orig = full_img.shape[:2]
    print(f"   Dimensioni mosaico: {w_orig} x {h_orig} px")
    os.makedirs(output_dir, exist_ok=True)
    step = int(tile_size * (1 - overlap))
    saved_count = 0
    ignore_threshold = 0.2
    for y in range(0, h_orig - tile_size + 1, step):
        for x in range(0, w_orig - tile_size + 1, step):
            patch = full_img[y:y + tile_size, x:x + tile_size]
            gray = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY)
            if (cv2.countNonZero(gray) / (tile_size ** 2)) >= ignore_threshold:
                cv2.imwrite(os.path.join(output_dir, f"tile_col_{x}_row_{y}.jpg"), patch)
                saved_count += 1
    print(f"✅ Taglio completato! {saved_count} tile in: {output_dir}")
    return saved_count

# ==============================================================================
# 🛠️ FUNZIONI DI SUPPORTO
# ==============================================================================

def get_best_weights(output_dir):
    best = os.path.join(output_dir, "model_best.pth")
    final = os.path.join(output_dir, "model_final.pth")
    if os.path.exists(best):
        size = os.path.getsize(best) / 1e6
        print(f"✅ Modello: model_best.pth ({size:.1f} MB)")
        return best
    elif os.path.exists(final):
        size = os.path.getsize(final) / 1e6
        print(f"⚠️  Modello: model_final.pth ({size:.1f} MB)")
        return final
    checkpoints = glob.glob(os.path.join(output_dir, "model_*.pth"))
    if checkpoints:
        latest = max(checkpoints, key=os.path.getctime)
        print(f"⚠️  Uso: {os.path.basename(latest)}")
        return latest
    print(f"❌ Nessun .pth trovato in {output_dir}")
    sys.exit(1)


def get_geo_tools(tif_path):
    if not os.path.exists(tif_path):
        return None, None
    try:
        with rasterio.open(tif_path) as src:
            affine, crs = src.transform, src.crs
        return affine, Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    except Exception as e:
        print(f"⚠️  Errore GeoTIFF (rasterio): {e}")
        return None, None


def leggi_gsd(tfw_path):
    if not os.path.exists(tfw_path):
        return None
    try:
        with open(tfw_path, "r") as f:
            lines = [l.strip() for l in f if l.strip()]
        gsd_raw = abs(float(lines[0]))
        if gsd_raw < 0.01:
            return gsd_raw * 111320
        return gsd_raw
    except Exception:
        return None


def calcola_area_m2(mask, gsd_m):
    if gsd_m is None:
        return None
    return round(int(np.sum(mask)) * (gsd_m ** 2), 4)


def filtra_punti_unici(detections, soglia_metri):
    unique = []
    detections.sort(key=lambda x: x['score'], reverse=True)
    for p in detections:
        found = False
        for u in unique:
            dist = math.sqrt((p['lat'] - u['lat'])**2 + (p['lon'] - u['lon'])**2) * 111320
            if dist < soglia_metri:
                n = u['count']
                u['lat'] = (u['lat'] * n + p['lat']) / (n + 1)
                u['lon'] = (u['lon'] * n + p['lon']) / (n + 1)
                u['gx']  = (u['gx']  * n + p['gx'])  / (n + 1)
                u['gy']  = (u['gy']  * n + p['gy'])  / (n + 1)
                u['count'] += 1
                found = True
                break
        if not found:
            unique.append({**p, 'count': 1})
    return unique

# ==============================================================================
# 💾 ESPORTAZIONI
# ==============================================================================

def esporta_csv(panels, path):
    rows = [{
        "pannello_id": p.get('id', 0),
        "latitudine":  round(p['lat'], 8),
        "longitudine": round(p['lon'], 8),
        "classe":      CLASS_NAMES.get(p.get('class_id', 0), "PV_Module"),
        "score":       round(p['score'], 4),
        "area_m2":     p.get('area_m2'),
        "pixel_x":     int(p['gx']),
        "pixel_y":     int(p['gy']),
    } for p in panels]
    pd.DataFrame(rows).to_csv(path, index=False)
    print(f"✅ CSV salvato: {path}  ({len(rows)} righe)")


def esporta_geojson(panels, path):
    geometries, attrs = [], []
    for p in panels:
        if p.get('contour') is not None:
            pts = [(int(c[0][0]), int(c[0][1])) for c in p['contour']]
            geom = Polygon(pts) if len(pts) >= 3 else Point(p['lon'], p['lat'])
        else:
            geom = Point(p['lon'], p['lat'])
        geometries.append(geom)
        attrs.append({"id": p.get('id', 0), "classe": CLASS_NAMES.get(p.get('class_id', 0), "PV_Module"),
                      "score": round(p['score'], 4), "area_m2": p.get('area_m2')})
    gpd.GeoDataFrame(attrs, geometry=geometries, crs="EPSG:4326").to_file(path, driver="GeoJSON")
    print(f"✅ GeoJSON salvato: {path}  ({len(panels)} features)")


def esporta_kmz(kml_path, kmz_path):
    with zipfile.ZipFile(kmz_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(kml_path, arcname="doc.kml")
    print(f"✅ KMZ salvato: {kmz_path}")


def setup_cfg(weights_path):
    cfg = get_cfg()
    cfg.set_new_allowed(True)
    add_maskdino_config(cfg)
    cfg.merge_from_file(YAML_CONFIG)
    cfg.MODEL.WEIGHTS = weights_path
    force_cpu = os.getenv("FORCE_CPU", "1") != "0"
    cfg.MODEL.DEVICE  = "cpu" if force_cpu or not torch.cuda.is_available() else "cuda"
    cfg.MODEL.ROI_HEADS.NUM_CLASSES    = NUM_CLASSES
    cfg.MODEL.SEM_SEG_HEAD.NUM_CLASSES = NUM_CLASSES
    cfg.MODEL.MaskDINO.NUM_CLASSES     = NUM_CLASSES
    cfg.MODEL.ROI_HEADS.SCORE_THRESH_TEST         = SOGLIA_DETECTION
    cfg.MODEL.MaskDINO.TEST.OBJECT_MASK_THRESHOLD = 0.3
    cfg.INPUT.MIN_SIZE_TEST = 800
    cfg.INPUT.MAX_SIZE_TEST = 1600
    return cfg

# ==============================================================================
# 🚀 MAIN
# ==============================================================================

def parse_args():
    parser = argparse.ArgumentParser(description="Solar Panel Detection — MaskDINO Pipeline")
    parser.add_argument("--tif",     required=True)
    parser.add_argument("--tfw",     required=True)
    parser.add_argument("--outdir",  required=True)
    parser.add_argument("--weights", default=None)
    return parser.parse_args()


def main():
    args = parse_args()

    weights_dir       = args.weights if args.weights else os.path.join(BASE_DIR, "output_tesi")
    tiles_dir         = os.path.join(args.outdir, "tiles")
    vis_dir           = os.path.join(args.outdir, "vis")
    out_csv           = os.path.join(args.outdir, "Rilevamenti_Pannelli.csv")
    out_geojson       = os.path.join(args.outdir, "Rilevamenti_Pannelli.geojson")
    out_json          = os.path.join(args.outdir, "Rilevamenti_Pannelli.json")
    out_kml           = os.path.join(args.outdir, "Mappa_Pannelli.kml")
    out_kmz           = os.path.join(args.outdir, "Mappa_Pannelli.kmz")
    out_mosaic        = os.path.join(args.outdir, "Mosaico_Finale_Rilevato.jpg")

    os.makedirs(args.outdir, exist_ok=True)

    print("\n" + "="*60)
    print("  INFERENZA SOLAR PANELS — MaskDINO v5")
    print("="*60)

    # 1. Taglio Tile
    num_tiles = taglio_tile(args.tif, tiles_dir, TILE_SIZE, OVERLAP)
    if num_tiles == 0:
        sys.exit(1)

    # 2. Setup Modello
    print(f"\n🤖 FASE 2: Avvio Modello MaskDINO...")
    weights_path = get_best_weights(weights_dir)
    cfg          = setup_cfg(weights_path)
    predictor    = DefaultPredictor(cfg)
    print(f"   Device: {cfg.MODEL.DEVICE.upper()}")
    os.makedirs(vis_dir, exist_ok=True)

    # 3. Setup Geografico
    gsd_m = leggi_gsd(args.tfw)
    if gsd_m:
        print(f"📐 GSD: {gsd_m*100:.2f} cm/pixel")

    affine, geo_transformer = get_geo_tools(args.tif)
    usa_fallback_geo = affine is None or geo_transformer is None
    tfw_fallback = None
    if usa_fallback_geo:
        print("⚠️  Rasterio CRS non trovato — uso fallback TFW.")
        try:
            with open(args.tfw, 'r') as f:
                lines = [float(l.strip()) for l in f if l.strip()]
            tfw_fallback = {"px_x": lines[0], "rot_y": lines[1], "rot_x": lines[2],
                            "px_y": lines[3], "orig_x": lines[4], "orig_y": lines[5]}
        except Exception as e:
            print(f"❌ Impossibile leggere TFW: {e}")
            tfw_fallback = None

    # 4. Loop Inferenza
    all_files = sorted(glob.glob(os.path.join(tiles_dir, "tile_col_*_row_*.jpg")))
    raw_detections = []
    total_panels   = 0

    print(f"\n🔍 Analisi {len(all_files)} tile in corso...")
    for i, path in enumerate(all_files):
        filename     = os.path.basename(path)
        match        = re.search(r"tile_col_(\d+)_row_(\d+)", filename)
        off_x, off_y = (int(match.group(1)), int(match.group(2))) if match else (0, 0)

        img = cv2.imread(path)
        if img is None:
            continue

        outputs   = predictor(img)
        instances = outputs["instances"].to("cpu")

        if len(instances) > 0:
            instances._fields['scores'] = torch.clamp(instances.scores * BOOST, max=1.0)
            instances = instances[instances.scores >= SOGLIA_DETECTION]

        if len(instances) > 0:
            keep      = nms(instances.pred_boxes.tensor, instances.scores, NMS_THRESH)
            instances = instances[keep]

        num_panels   = len(instances)
        total_panels += num_panels

        if i % 20 == 0 or num_panels > 0:
            print(f"📸 [{i+1:3d}/{len(all_files)}] {filename:<30} | Pannelli: {num_panels:2d}")

        if num_panels == 0:
            continue

        masks   = instances.pred_masks.numpy()
        boxes   = instances.pred_boxes.tensor.numpy()
        scores  = instances.scores.numpy()
        classes = instances.pred_classes.numpy() if instances.has("pred_classes") else np.zeros(num_panels, dtype=int)

        for k in range(num_panels):
            mask_u8     = (masks[k].astype("uint8") * 255)
            contours, _ = cv2.findContours(mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            global_contour = None
            if contours:
                c = max(contours, key=cv2.contourArea)
                M = cv2.moments(c)
                if M["m00"] != 0:
                    cx_local = int(M["m10"] / M["m00"])
                    cy_local = int(M["m01"] / M["m00"])
                else:
                    cx_local = int((boxes[k][0] + boxes[k][2]) / 2)
                    cy_local = int((boxes[k][1] + boxes[k][3]) / 2)
                global_contour = c.copy()
                global_contour[:, :, 0] += off_x
                global_contour[:, :, 1] += off_y
            else:
                cx_local = int((boxes[k][0] + boxes[k][2]) / 2)
                cy_local = int((boxes[k][1] + boxes[k][3]) / 2)

            gx, gy = off_x + cx_local, off_y + cy_local

            if tfw_fallback:
                lon = tfw_fallback['px_x'] * gx + tfw_fallback['rot_x'] * gy + tfw_fallback['orig_x']
                lat = tfw_fallback['rot_y'] * gx + tfw_fallback['px_y'] * gy + tfw_fallback['orig_y']
            elif affine and geo_transformer:
                proj_x, proj_y = affine * (gx, gy)
                lon, lat = geo_transformer.transform(proj_x, proj_y)
            else:
                lon, lat = 0.0, 0.0

            raw_detections.append({
                'lat': lat, 'lon': lon, 'gx': gx, 'gy': gy,
                'score': float(scores[k]), 'class_id': int(classes[k]),
                'area_m2': calcola_area_m2(masks[k], gsd_m),
                'contour': global_contour,
            })

    print(f"\n{'─'*60}")
    print(f"🔍 FASE 3: Post-processing — rilevati (pre-fusione): {total_panels}")

    if not raw_detections:
        print("❌ Nessun pannello rilevato.")
        with open(out_json, 'w') as f:
            json.dump({"pannelli": []}, f)
        sys.exit(0)

    # 5. NMS Spaziale
    print(f"🔄 Fusione duplicati (soglia: {MERGE_DIST_METERS}m)...")
    final_panels = filtra_punti_unici(raw_detections, MERGE_DIST_METERS)
    final_panels = [p for p in final_panels if p['score'] >= SCORE_MIN_EXPORT]
    for idx, p in enumerate(final_panels):
        p['id'] = idx + 1
    print(f"   Pannelli FISICI finali: {len(final_panels)}")

    # 6. Esportazioni
    esporta_csv(final_panels, out_csv)
    esporta_geojson(final_panels, out_geojson)

    with open(out_json, 'w') as f:
        json_data = [{k: v for k, v in p.items() if k != 'contour'} for p in final_panels]
        json.dump({"pannelli": json_data}, f, indent=4)
    print(f"✅ JSON salvato: {out_json}")

    kml   = simplekml.Kml()
    style = simplekml.Style()
    style.iconstyle.icon.href = 'http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png'
    style.iconstyle.color     = 'ff0000ff'
    style.iconstyle.scale     = 0.5
    for p in final_panels:
        pnt = kml.newpoint(name=f"Pan_{p['id']}", coords=[(p['lon'], p['lat'])])
        pnt.description = (f"ID: {p['id']}\nClasse: {CLASS_NAMES.get(p.get('class_id',0),'PV_Module')}\n"
                           f"Score: {p['score']:.2f}\nArea: {p.get('area_m2','N/A')} m²")
        pnt.style = style
    kml.save(out_kml)
    print(f"✅ KML salvato: {out_kml}")
    esporta_kmz(out_kml, out_kmz)

    # 7. Mosaico annotato
    if os.path.exists(args.tif):
        print("🖼️  Generazione mosaico annotato...")
        try:
            mosaico = cv2.imread(args.tif)
            if mosaico is not None:
                for p in final_panels:
                    color = CLASS_COLORS.get(p.get('class_id', 0), (0, 200, 0))
                    if p.get('contour') is not None:
                        cv2.drawContours(mosaico, [p['contour']], -1, color, 2)
                        cv2.putText(mosaico, f"{p['score']:.2f}", (int(p['gx']), int(p['gy']) - 10),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1, cv2.LINE_AA)
                    else:
                        cv2.circle(mosaico, (int(p['gx']), int(p['gy'])), DOT_RADIUS_MOSAIC, color, -1)
                cv2.imwrite(out_mosaic, mosaico)
                print(f"✅ Mosaico salvato: {out_mosaic}")
        except Exception as e:
            print(f"⚠️  Mosaico non generato: {e}")

    print(f"\n🎯 PANNELLI SOLARI RILEVATI: {len(final_panels)}")
    print("🎯 PROCEDURA COMPLETATA.\n")


if __name__ == "__main__":
    main()

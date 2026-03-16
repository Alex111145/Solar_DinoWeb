#!/usr/bin/env python
"""
inferenzanuovosito.py - Pipeline Completa MaskDINO Solar Panels (v4 - FINAL)
=============================================================================
Questa pipeline unifica il taglio dell'ortomosaico e l'inferenza avanzata:
  - 1. Taglio automatico del TIF in tile (con overlap)
  - 2. Inferenza MaskDINO (Soglia 0.50)
  - 3. Geolocalizzazione Pixel → UTM → WGS84 (Lat/Lon)
  - 4. NMS post-processing: Fusione duplicati per distanza tra tile adiacenti
  - 5. Calcolo area degradata (GSD²)
  - 6. Esportazione multipla: JSON, CSV, GeoJSON, KML, KMZ
  - 7. Generazione Mosaico Annotato finale
"""

import argparse
import os
import sys
import glob
import re
import math
import warnings
import json
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
from detectron2.utils.visualizer import Visualizer
from detectron2.data import MetadataCatalog
from detectron2.layers import nms

try:
    from maskdino import add_maskdino_config
except ImportError:
    print("❌ Errore: 'maskdino' non trovata. Esegui dalla root del progetto.")
    sys.exit(1)

# ==============================================================================
# ⚙️ CONFIGURAZIONE PARAMETRI
# ==============================================================================
BASE_DIR             = os.path.dirname(os.path.abspath(__file__))

# --- INPUT ---
ORTOMOSAICO_PATH     = os.path.join(BASE_DIR, "ortomosaico_nuovo.tif")
TFW_PATH             = os.path.join(BASE_DIR, "ortomosaico_nuovo.tfw")
OUTPUT_DIR           = os.path.join(BASE_DIR, "output_tesi")         # Cartella pesi modello
YAML_CONFIG          = os.path.join(BASE_DIR, "tesi_config.yaml")    # File YAML configurazione

# --- PARAMETRI TAGLIO ---
OUTPUT_TILES_DIR     = os.path.join(BASE_DIR, "tiles_nuovo_sito")
TILE_SIZE            = 800
OVERLAP              = 0.70

# --- OUTPUT INFERENZA ---
VIS_OUTPUT_DIR       = os.path.join(BASE_DIR, "inference_results")
OUTPUT_MOSAIC_MARKED = "Mosaico_Finale_Rilevato.jpg"
OUTPUT_KML           = "Mappa_Pannelli.kml"
OUTPUT_KMZ           = "Mappa_Pannelli.kmz"
OUTPUT_CSV           = "Rilevamenti_Pannelli.csv"
OUTPUT_GEOJSON       = "Rilevamenti_Pannelli.geojson"
OUTPUT_JSON          = "Rilevamenti_Pannelli.json"

# --- IPERPARAMETRI ---
NUM_CLASSES          = 1
SOGLIA_DETECTION     = 0.50
NMS_THRESH           = 0.40
MERGE_DIST_METERS    = 1.0   # Distanza max (in metri) per fondere pannelli doppi
DOT_RADIUS_MOSAIC    = 8
BOOST                = 2.5
SCORE_MIN_EXPORT     = 0.5

# Colori per classe (BGR): integro=verde, hotspot=rosso, degrado=arancione
CLASS_COLORS = {
    0: (0, 200, 0),    # PV_Module  → verde
    1: (0, 0, 255),    # Hotspot    → rosso
    2: (0, 140, 255),  # Degrado    → arancione
}
CLASS_NAMES = {0: "PV_Module", 1: "Hotspot", 2: "Degrado"}

# ==============================================================================
# ✂️ FASE 1: FUNZIONI DI TAGLIO
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
            patch = full_img[y : y + tile_size, x : x + tile_size]
            gray = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY)
            
            if (cv2.countNonZero(gray) / (tile_size ** 2)) >= ignore_threshold:
                filename = f"tile_col_{x}_row_{y}.jpg"
                cv2.imwrite(os.path.join(output_dir, filename), patch)
                saved_count += 1

    print(f"✅ Taglio completato! {saved_count} tile salvate in: {output_dir}")
    return saved_count

# ==============================================================================
# 🛠️ FASE 2: FUNZIONI DI INFERENZA E GEOLOCALIZZAZIONE
# ==============================================================================

def get_best_weights(output_dir):
    best  = os.path.join(output_dir, "model_best.pth")
    final = os.path.join(output_dir, "model_final.pth")
    if os.path.exists(best):
        print(f"✅ Modello: model_best.pth")
        return best
    elif os.path.exists(final):
        print(f"✅ Modello: model_final.pth")
        return final
    else:
        checkpoints = glob.glob(os.path.join(output_dir, "model_*.pth"))
        if checkpoints:
            latest = max(checkpoints, key=os.path.getctime)
            return latest
        print(f"❌ Nessun .pth trovato in {output_dir}")
        sys.exit(1)


def get_geo_tools(tif_path):
    if not os.path.exists(tif_path):
        return None, None
    try:
        with rasterio.open(tif_path) as src:
            affine, crs = src.transform, src.crs
        # Converte da sistema di riferimento del TIF (es. UTM) a WGS84 (Lat/Lon EPSG:4326)
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
        # Il parametro A del TFW è la dimensione del pixel in X
        gsd_raw = abs(float(lines[0]))
        # Se il TFW è in gradi (molto raro per drone, di solito è in metri), lo converte
        if gsd_raw < 0.01: 
            return gsd_raw * 111320
        return gsd_raw # È già in metri
    except Exception as e:
        return None


def calcola_area_m2(mask, gsd_m):
    if gsd_m is None:
        return None
    n_pixel = int(np.sum(mask))
    return round(n_pixel * (gsd_m ** 2), 4)


def filtra_punti_unici(detections, soglia_metri):
    """Fonde rilevamenti multipli provenienti dall'overlap tra tile."""
    unique = []
    detections.sort(key=lambda x: x['score'], reverse=True)
    for p in detections:
        found = False
        for u in unique:
            # Calcolo distanza approssimata in metri
            dist = math.sqrt((p['lat'] - u['lat'])**2 + (p['lon'] - u['lon'])**2) * 111320
            if dist < soglia_metri:
                n = u['count']
                u['lat']   = (u['lat'] * n + p['lat'])   / (n + 1)
                u['lon']   = (u['lon'] * n + p['lon'])   / (n + 1)
                u['gx']    = (u['gx']  * n + p['gx'])    / (n + 1)
                u['gy']    = (u['gy']  * n + p['gy'])    / (n + 1)
                u['count'] += 1
                found = True
                break
        if not found:
            unique.append({**p, 'count': 1})
    return unique

# ==============================================================================
# 💾 FASE 3: FUNZIONI DI EXPORT
# ==============================================================================

def esporta_csv(panels, path):
    rows = []
    for p in panels:
        rows.append({
            "pannello_id": p.get('id', 0),
            "latitudine":  round(p['lat'], 8),
            "longitudine": round(p['lon'], 8),
            "classe":      CLASS_NAMES.get(p.get('class_id', 0), "PV_Module"),
            "score":       round(p['score'], 4),
            "area_m2":     p.get('area_m2', None),
            "pixel_x":     int(p['gx']),
            "pixel_y":     int(p['gy']),
        })
    df = pd.DataFrame(rows)
    df.to_csv(path, index=False)
    print(f"✅ CSV salvato: {path}  ({len(df)} righe)")


def esporta_geojson(panels, path):
    geometries = []
    attrs      = []
    for p in panels:
        # Se c'è un contorno globale, crea un Poligono, altrimenti un Punto
        if p.get('contour') is not None:
            pts = [(int(c[0][0]), int(c[0][1])) for c in p['contour']]
            geom = Polygon(pts) if len(pts) >= 3 else Point(p['lon'], p['lat'])
        else:
            geom = Point(p['lon'], p['lat'])
            
        geometries.append(geom)
        attrs.append({
            "id":      p.get('id', 0),
            "classe":  CLASS_NAMES.get(p.get('class_id', 0), "PV_Module"),
            "score":   round(p['score'], 4),
            "area_m2": p.get('area_m2', None),
        })
    gdf = gpd.GeoDataFrame(attrs, geometry=geometries, crs="EPSG:4326")
    gdf.to_file(path, driver="GeoJSON")
    print(f"✅ GeoJSON salvato: {path}  ({len(gdf)} features)")


def esporta_kmz(kml_path, kmz_path):
    import zipfile
    with zipfile.ZipFile(kmz_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(kml_path, arcname="doc.kml")
    print(f"✅ KMZ salvato: {kmz_path}")


def setup_cfg(weights_path):
    cfg = get_cfg()
    cfg.set_new_allowed(True)
    add_maskdino_config(cfg)
    cfg.merge_from_file(YAML_CONFIG)

    cfg.MODEL.WEIGHTS = weights_path
    # Forza CPU sul server (es. Render senza GPU). Imposta FORCE_CPU=0 per abilitare CUDA.
    force_cpu = os.getenv("FORCE_CPU", "1") != "0"
    cfg.MODEL.DEVICE  = "cpu" if force_cpu or not torch.cuda.is_available() else "cuda"

    cfg.MODEL.ROI_HEADS.NUM_CLASSES    = NUM_CLASSES
    cfg.MODEL.SEM_SEG_HEAD.NUM_CLASSES = NUM_CLASSES
    cfg.MODEL.MaskDINO.NUM_CLASSES     = NUM_CLASSES

    cfg.MODEL.ROI_HEADS.SCORE_THRESH_TEST            = SOGLIA_DETECTION
    cfg.MODEL.MaskDINO.TEST.OBJECT_MASK_THRESHOLD    = 0.3

    cfg.INPUT.MIN_SIZE_TEST = 800
    cfg.INPUT.MAX_SIZE_TEST = 1600

    return cfg

# ==============================================================================
# 🚀 MAIN PIPELINE
# ==============================================================================

def parse_args():
    parser = argparse.ArgumentParser(
        description="Solar Panel Detection — MaskDINO Pipeline",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--tif",     required=True,  help="Percorso ortomosaico .tif")
    parser.add_argument("--tfw",     required=True,  help="Percorso file .tfw di georeferenziazione")
    parser.add_argument("--outdir",  required=True,  help="Cartella di output per tutti i risultati")
    parser.add_argument("--weights", default=None,   help="Cartella pesi modello (default: core/output_tesi)")
    return parser.parse_args()


def main():
    args = parse_args()

    # Sovrascrive i path globali con i valori passati da CLI
    global ORTOMOSAICO_PATH, TFW_PATH, OUTPUT_DIR
    global OUTPUT_TILES_DIR, VIS_OUTPUT_DIR
    global OUTPUT_CSV, OUTPUT_GEOJSON, OUTPUT_JSON, OUTPUT_KML, OUTPUT_KMZ, OUTPUT_MOSAIC_MARKED

    ORTOMOSAICO_PATH     = args.tif
    TFW_PATH             = args.tfw
    OUTPUT_DIR           = args.weights if args.weights else os.path.join(BASE_DIR, "output_tesi")
    OUTPUT_TILES_DIR     = os.path.join(args.outdir, "tiles")
    VIS_OUTPUT_DIR       = os.path.join(args.outdir, "vis")
    OUTPUT_CSV           = os.path.join(args.outdir, "Rilevamenti_Pannelli.csv")
    OUTPUT_GEOJSON       = os.path.join(args.outdir, "Rilevamenti_Pannelli.geojson")
    OUTPUT_JSON          = os.path.join(args.outdir, "Rilevamenti_Pannelli.json")
    OUTPUT_KML           = os.path.join(args.outdir, "Mappa_Pannelli.kml")
    OUTPUT_KMZ           = os.path.join(args.outdir, "Mappa_Pannelli.kmz")
    OUTPUT_MOSAIC_MARKED = os.path.join(args.outdir, "Mosaico_Finale_Rilevato.jpg")

    os.makedirs(args.outdir, exist_ok=True)

    print("\n" + "="*60)
    print("  INFERENZA SOLAR PANELS — Pipeline Completa Nuovo Sito")
    print("="*60)

    # 1. Taglio Tile
    num_tiles = taglio_tile(ORTOMOSAICO_PATH, OUTPUT_TILES_DIR, TILE_SIZE, OVERLAP)
    if num_tiles == 0:
        return

    # 2. Setup Modello AI
    print(f"\n🤖 FASE 2: Avvio Modello MaskDINO...")
    weights_path = get_best_weights(OUTPUT_DIR)
    cfg          = setup_cfg(weights_path)
    predictor    = DefaultPredictor(cfg)

    device = cfg.MODEL.DEVICE.upper()
    print(f"   Device in uso: {device}")
    
    os.makedirs(VIS_OUTPUT_DIR, exist_ok=True)

    # 3. Setup Strumenti Geografici
    gsd_m = leggi_gsd(TFW_PATH)
    if gsd_m:
        print(f"📐 GSD rilevato: {gsd_m*100:.2f} cm/pixel")
        
    affine, geo_transformer = get_geo_tools(ORTOMOSAICO_PATH)
    
    # Fallback logica manuale TFW se rasterio non riesce a estrarre CRS
    usa_fallback_geo = False
    if affine is None or geo_transformer is None:
        print("⚠️  Rasterio CRS non trovato. Uso fallback vettoriale standard sul TFW.")
        usa_fallback_geo = True
        with open(TFW_PATH, 'r') as f:
            lines = [float(l.strip()) for l in f if l.strip()]
        tfw_fallback = {
            "px_x": lines[0], "rot_y": lines[1], "rot_x": lines[2],
            "px_y": lines[3], "orig_x": lines[4], "orig_y": lines[5]
        }

    # 4. Loop Inferenza sulle Tile
    all_files = sorted(glob.glob(os.path.join(OUTPUT_TILES_DIR, "tile_col_*_row_*.jpg")))
    raw_detections = []
    total_panels = 0

    print("\n🔍 Analisi in corso sulle patch...")
    for i, path in enumerate(all_files):
        filename = os.path.basename(path)
        match    = re.search(r"tile_col_(\d+)_row_(\d+)", filename)
        off_x, off_y = (int(match.group(1)), int(match.group(2))) if match else (0, 0)

        img = cv2.imread(path)
        if img is None: continue

        outputs   = predictor(img)
        instances = outputs["instances"].to("cpu")

        if len(instances) > 0:
            instances._fields['scores'] = torch.clamp(instances.scores * BOOST, max=1.0)
            score_mask = instances.scores >= SOGLIA_DETECTION
            instances  = instances[score_mask]

        if len(instances) > 0:
            keep      = nms(instances.pred_boxes.tensor, instances.scores, NMS_THRESH)
            instances = instances[keep]

        num_panels = len(instances)
        total_panels += num_panels

        if i % 20 == 0 or num_panels > 0:
            print(f"📸 [{i+1:3d}/{len(all_files)}] {filename:<30} | Pannelli trovati: {num_panels:2d}")

        if num_panels == 0:
            continue

        # Estrazione Dati e Coordinate Globale
        masks    = instances.pred_masks.numpy()
        boxes    = instances.pred_boxes.tensor.numpy()
        scores   = instances.scores.numpy()
        classes  = instances.pred_classes.numpy() if instances.has("pred_classes") else np.zeros(num_panels, dtype=int)

        for k in range(num_panels):
            mask_u8     = (masks[k].astype("uint8") * 255)
            contours, _ = cv2.findContours(mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            global_contour = None
            if contours:
                c  = max(contours, key=cv2.contourArea)
                M  = cv2.moments(c)
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

            # Posizione globale nel mosaico
            gx, gy = off_x + cx_local, off_y + cy_local
            
            # Trasformazione Geo
            if usa_fallback_geo:
                lon = (tfw_fallback['px_x'] * gx) + (tfw_fallback['rot_x'] * gy) + tfw_fallback['orig_x']
                lat = (tfw_fallback['rot_y'] * gx) + (tfw_fallback['px_y'] * gy) + tfw_fallback['orig_y']
            else:
                proj_x, proj_y = affine * (gx, gy)
                lon, lat = geo_transformer.transform(proj_x, proj_y)

            # Area
            area_m2 = calcola_area_m2(masks[k], gsd_m)

            raw_detections.append({
                'lat':      lat,
                'lon':      lon,
                'gx':       gx,
                'gy':       gy,
                'score':    float(scores[k]),
                'class_id': int(classes[k]),
                'area_m2':  area_m2,
                'contour':  global_contour
            })

    print(f"\n{'─'*60}")
    print(f"🔍 FASE 3: Post-processing e Salvataggio")
    print(f"   Pannelli rilevati (con overlap): {total_panels}")

    if not raw_detections:
        print("❌ Nessun pannello rilevato nel sito.")
        sys.exit(0)

    # 5. NMS Spaziale (Rimozione doppioni sui bordi delle tile)
    print(f"🔄 Fusione duplicati overlap (soglia: {MERGE_DIST_METERS}m)...")
    final_panels = filtra_punti_unici(raw_detections, MERGE_DIST_METERS)
    final_panels = [p for p in final_panels if p['score'] >= SCORE_MIN_EXPORT]
    
    # Assegna ID unico
    for idx, p in enumerate(final_panels):
        p['id'] = idx + 1
        
    print(f"   Pannelli FISICI finali: {len(final_panels)}")

    # 6. Esportazioni Dati
    esporta_csv(final_panels, OUTPUT_CSV)
    esporta_geojson(final_panels, OUTPUT_GEOJSON)
    
    # Salvataggio JSON base
    with open(OUTPUT_JSON, 'w') as f:
        # Pulisco i contour (array numpy) prima di salvare il JSON
        json_data = [{k: v for k, v in p.items() if k != 'contour'} for p in final_panels]
        json.dump({"pannelli": json_data}, f, indent=4)
    print(f"✅ JSON salvato: {OUTPUT_JSON}")

    # KML + KMZ
    kml   = simplekml.Kml()
    style = simplekml.Style()
    style.iconstyle.icon.href = 'http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png'
    style.iconstyle.color     = 'ff0000ff'
    style.iconstyle.scale     = 0.5

    for p in final_panels:
        classe_nome = CLASS_NAMES.get(p.get('class_id', 0), "PV_Module")
        pnt             = kml.newpoint(name=f"Pan_{p['id']}", coords=[(p['lon'], p['lat'])])
        pnt.description = (
            f"ID: {p['id']}\n"
            f"Classe: {classe_nome}\n"
            f"Score: {p['score']:.2f}\n"
            f"Area: {p.get('area_m2', 'N/A')} m²"
        )
        pnt.style = style

    kml.save(OUTPUT_KML)
    print(f"✅ KML salvato: {OUTPUT_KML}")
    esporta_kmz(OUTPUT_KML, OUTPUT_KMZ)

    # 7. Disegno su Mosaico Finale
    if os.path.exists(ORTOMOSAICO_PATH):
        print("🖼️  Generazione mosaico annotato in corso (potrebbe richiedere RAM)...")
        try:
            mosaico = cv2.imread(ORTOMOSAICO_PATH)
            if mosaico is not None:
                for p in final_panels:
                    color = CLASS_COLORS.get(p.get('class_id', 0), (0, 200, 0))
                    if p.get('contour') is not None:
                        cv2.drawContours(mosaico, [p['contour']], -1, color, 2)
                        cx, cy = int(p['gx']), int(p['gy'])
                        cv2.putText(
                            mosaico, f"{p['score']:.2f}", (cx, cy - 10),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1, cv2.LINE_AA
                        )
                    else:
                        cv2.circle(mosaico, (int(p['gx']), int(p['gy'])), DOT_RADIUS_MOSAIC, color, -1)
                cv2.imwrite(OUTPUT_MOSAIC_MARKED, mosaico)
                print(f"✅ Mosaico salvato: {OUTPUT_MOSAIC_MARKED}")
        except Exception as e:
            print(f"⚠️  Impossibile generare mosaico annotato (probabile file troppo grande per la RAM): {e}")

    print("\n🎯 PROCEDURA COMPLETATA CON SUCCESSO!\n")


if __name__ == "__main__":
    main()
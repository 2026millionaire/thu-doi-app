"""
Merge PL A8 data (phí mài KC / đá màu / mất giấy GIA / bảng giá KC tấm)
vào data.json.

PL A8 có 5 mục:
  I.   Phí mài kim cương theo size
  II.  Phí mài đá màu theo loại + size
  III. Phí mất giấy GIA theo size
  IV.  Phí giám định/ép seal (tham khảo PNJL - link PDF riêng, không import)
  V.   Bảng giá mua lại KC tấm (~200 mã)

Nguồn: C:\\Users\\ASUS\\OneDrive\\Desktop\\PNJ - CHINH SACH\\0. THU DOI\\
       [ThuDoi] PL_A08 - ...pdf

Chạy: python merge_pl_a8.py
"""
import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

HERE = Path(__file__).parent
DATA_PATH = HERE.parent / "data.json"

# === I. PHÍ MÀI KIM CƯƠNG ===
PHI_MAI_KC = [
    {"size_min": 3.00, "size_max": 3.49, "phi": 200_000},
    {"size_min": 3.50, "size_max": 3.99, "phi": 250_000},
    {"size_min": 4.00, "size_max": 4.99, "phi": 300_000},
    {"size_min": 5.00, "size_max": 5.99, "phi": 400_000},
    {"size_min": 6.00, "size_max": 6.99, "phi": 700_000},
    {"size_min": 7.00, "size_max": 7.99, "phi": 900_000},
    {"size_min": 8.00, "size_max": 8.49, "phi": 1_650_000},
    {"size_min": 8.50, "size_max": 8.99, "phi": 2_200_000},
    {"size_min": 9.00, "size_max": 9.49, "phi": 3_300_000},
    {"size_min": 9.50, "size_max": 9.99, "phi": 4_400_000},
    {"size_min": 10.00, "size_max": 99.0, "phi": None, "note": "Báo giá từng viên"},
]

# === II. PHÍ MÀI ĐÁ MÀU ===
PHI_MAI_DA_MAU = {
    "cao_cap": {
        "ten_loai": ["Ruby", "Sapphire", "Emerald", "Tanzanite", "Morganite"],
        "brackets": [
            {"size_min": 3.0, "size_max": 5.0, "phi": 130_000, "note": "3mm ≤ Size ≤ 5mm"},
            {"size_min": 5.01, "size_max": 8.99, "phi": 170_000, "note": "5mm < size < 9mm"},
            {"size_min": 9.0, "size_max": 99.0, "phi": 250_000, "note": "Size ≥ 9mm"},
        ],
    },
    "thuong": {
        "ten_loai": ["Topaz", "Citrin", "Moon", "Đá màu khác"],
        "brackets": [
            {"size_min": 4.0, "size_max": 6.0, "phi": 55_000, "note": "4mm ≤ Size ≤ 6mm"},
            {"size_min": 6.01, "size_max": 8.99, "phi": 70_000, "note": "6mm < size < 9mm"},
            {"size_min": 9.0, "size_max": 99.0, "phi": 90_000, "note": "Size ≥ 9mm"},
        ],
    },
}

# === III. PHÍ MẤT GIẤY GIA ===
PHI_MAT_GIAY_GIA = [
    {"size_min": 3.5, "size_max": 3.79, "phi": 1_500_000},
    {"size_min": 3.8, "size_max": 3.99, "phi": 1_500_000},
    {"size_min": 4.0, "size_max": 4.49, "phi": 1_900_000},
    {"size_min": 4.5, "size_max": 4.99, "phi": 1_900_000},
    {"size_min": 5.0, "size_max": 5.39, "phi": 2_400_000},
    {"size_min": 5.4, "size_max": 5.99, "phi": 2_650_000},
    {"size_min": 6.0, "size_max": 6.49, "phi": 4_600_000},
    {"size_min": 6.5, "size_max": 6.99, "phi": 6_100_000},
    {"size_min": 7.0, "size_max": 7.49, "phi": 8_000_000},
    {"size_min": 7.5, "size_max": 7.99, "phi": 12_000_000},
    {"size_min": 8.0, "size_max": 8.29, "phi": 13_500_000},
    {"size_min": 8.3, "size_max": 8.59, "phi": 18_200_000},
    {"size_min": 8.6, "size_max": 8.79, "phi": 25_000_000},
    {"size_min": 8.8, "size_max": 8.99, "phi": 28_000_000},
    {"size_min": 9.0, "size_max": 9.29, "phi": 38_000_000},
    {"size_min": 9.3, "size_max": 9.59, "phi": 50_000_000},
    {"size_min": 9.6, "size_max": 9.99, "phi": 65_000_000},
]

# === V. BẢNG GIÁ MUA LẠI KIM CƯƠNG TẤM ===
# format: (mã, hình dáng, chất lượng, cạnh_lớn, cạnh_nhỏ, giá)
# Dữ liệu parse từ PDF PL A8 mục V.
GIA_KC_TAM = [
    # KC tròn VS1 (0.8 → 3.4)
    ("DD1100050.0008008", "tròn", "VS1", 0.8, 0.8, 28_000),
    ("DD1100050.0009009", "tròn", "VS1", 0.9, 0.9, 45_000),
    ("DD1100050.0010010", "tròn", "VS1", 1.0, 1.0, 58_000),
    ("DD1100050.0011011", "tròn", "VS1", 1.1, 1.1, 75_000),
    ("DD1100050.0012012", "tròn", "VS1", 1.2, 1.2, 83_000),
    ("DD1100050.0013013", "tròn", "VS1", 1.3, 1.3, 103_000),
    ("DD1100050.0014014", "tròn", "VS1", 1.4, 1.4, 130_000),
    ("DD1100050.0015015", "tròn", "VS1", 1.5, 1.5, 155_000),
    ("DD1100050.0016016", "tròn", "VS1", 1.6, 1.6, 194_000),
    ("DD1100050.0017017", "tròn", "VS1", 1.7, 1.7, 230_000),
    ("DD1100050.0018018", "tròn", "VS1", 1.8, 1.8, 279_000),
    ("DD1100050.0019019", "tròn", "VS1", 1.9, 1.9, 329_000),
    ("DD1100050.0020020", "tròn", "VS1", 2.0, 2.0, 387_000),
    ("DD1100050.0021021", "tròn", "VS1", 2.1, 2.1, 437_000),
    ("DD1100050.0022022", "tròn", "VS1", 2.2, 2.2, 524_000),
    ("DD1100050.0023023", "tròn", "VS1", 2.3, 2.3, 594_000),
    ("DD1100050.0024024", "tròn", "VS1", 2.4, 2.4, 760_000),
    ("DD1100050.0025025", "tròn", "VS1", 2.5, 2.5, 891_000),
    ("DD1100050.0026026", "tròn", "VS1", 2.6, 2.6, 1_012_000),
    ("DD1100050.0027027", "tròn", "VS1", 2.7, 2.7, 1_216_000),
    ("DD1100050.0028028", "tròn", "VS1", 2.8, 2.8, 1_472_000),
    ("DD1100050.0029029", "tròn", "VS1", 2.9, 2.9, 1_637_000),
    ("DD1100050.0030030", "tròn", "VS1", 3.0, 3.0, 1_913_000),
    ("DD1100050.0031031", "tròn", "VS1", 3.1, 3.1, 2_038_000),
    ("DD1100050.0032032", "tròn", "VS1", 3.2, 3.2, 2_138_000),
    ("DD1100050.0033033", "tròn", "VS1", 3.3, 3.3, 2_382_000),
    ("DD1100050.0034034", "tròn", "VS1", 3.4, 3.4, 2_819_000),
    # KC tròn AAA (SA) (0.8 → 3.2)
    ("DD1100120.0008008", "tròn", "AAA (SA)", 0.8, 0.8, 25_000),
    ("DD1100120.0009009", "tròn", "AAA (SA)", 0.9, 0.9, 38_000),
    ("DD1100120.0010010", "tròn", "AAA (SA)", 1.0, 1.0, 49_000),
    ("DD1100120.0011011", "tròn", "AAA (SA)", 1.1, 1.1, 63_000),
    ("DD1100120.0012012", "tròn", "AAA (SA)", 1.2, 1.2, 71_000),
    ("DD1100120.0013013", "tròn", "AAA (SA)", 1.3, 1.3, 87_000),
    ("DD1100120.0014014", "tròn", "AAA (SA)", 1.4, 1.4, 110_000),
    ("DD1100120.0015015", "tròn", "AAA (SA)", 1.5, 1.5, 132_000),
    ("DD1100120.0016016", "tròn", "AAA (SA)", 1.6, 1.6, 165_000),
    ("DD1100120.0017017", "tròn", "AAA (SA)", 1.7, 1.7, 195_000),
    ("DD1100120.0018018", "tròn", "AAA (SA)", 1.8, 1.8, 236_000),
    ("DD1100120.0019019", "tròn", "AAA (SA)", 1.9, 1.9, 279_000),
    ("DD1100120.0020020", "tròn", "AAA (SA)", 2.0, 2.0, 328_000),
    ("DD1100120.0021021", "tròn", "AAA (SA)", 2.1, 2.1, 370_000),
    ("DD1100120.0022022", "tròn", "AAA (SA)", 2.2, 2.2, 444_000),
    ("DD1100120.0023023", "tròn", "AAA (SA)", 2.3, 2.3, 518_000),
    ("DD1100120.0024024", "tròn", "AAA (SA)", 2.4, 2.4, 644_000),
    ("DD1100120.0025025", "tròn", "AAA (SA)", 2.5, 2.5, 755_000),
    ("DD1100120.0026026", "tròn", "AAA (SA)", 2.6, 2.6, 858_000),
    ("DD1100120.0027027", "tròn", "AAA (SA)", 2.7, 2.7, 1_031_000),
    ("DD1100120.0028028", "tròn", "AAA (SA)", 2.8, 2.8, 1_188_000),
    ("DD1100120.0029029", "tròn", "AAA (SA)", 2.9, 2.9, 1_387_000),
    ("DD1100120.0030030", "tròn", "AAA (SA)", 3.0, 3.0, 1_680_000),
    ("DD1100120.0031031", "tròn", "AAA (SA)", 3.1, 3.1, 1_840_000),
    ("DD1100120.0032032", "tròn", "AAA (SA)", 3.2, 3.2, 2_065_000),
    # KC vuông AAA (SA) (1.0 → 3.4)
    ("DD3100120.0010010", "vuông", "AAA (SA)", 1.0, 1.0, 87_000),
    ("DD3100120.0011011", "vuông", "AAA (SA)", 1.1, 1.1, 108_000),
    ("DD3100120.0012012", "vuông", "AAA (SA)", 1.2, 1.2, 126_000),
    ("DD3100120.0013013", "vuông", "AAA (SA)", 1.3, 1.3, 154_000),
    ("DD3100120.0014014", "vuông", "AAA (SA)", 1.4, 1.4, 190_000),
    ("DD3100120.0015015", "vuông", "AAA (SA)", 1.5, 1.5, 228_000),
    ("DD3100120.0016016", "vuông", "AAA (SA)", 1.6, 1.6, 270_000),
    ("DD3100120.0017017", "vuông", "AAA (SA)", 1.7, 1.7, 322_000),
    ("DD3100120.0018018", "vuông", "AAA (SA)", 1.8, 1.8, 391_000),
    ("DD3100120.0019019", "vuông", "AAA (SA)", 1.9, 1.9, 472_000),
    ("DD3100120.0020020", "vuông", "AAA (SA)", 2.0, 2.0, 518_000),
    ("DD3100120.0021021", "vuông", "AAA (SA)", 2.1, 2.1, 581_000),
    ("DD3100120.0022022", "vuông", "AAA (SA)", 2.2, 2.2, 661_000),
    ("DD3100120.0023023", "vuông", "AAA (SA)", 2.3, 2.3, 762_000),
    ("DD3100120.0024024", "vuông", "AAA (SA)", 2.4, 2.4, 972_000),
    ("DD3100120.0025025", "vuông", "AAA (SA)", 2.5, 2.5, 1_193_000),
    ("DD3100120.0026026", "vuông", "AAA (SA)", 2.6, 2.6, 1_381_000),
    ("DD3100120.0027027", "vuông", "AAA (SA)", 2.7, 2.7, 1_474_000),
    ("DD3100120.0028028", "vuông", "AAA (SA)", 2.8, 2.8, 1_898_000),
    ("DD3100120.0029029", "vuông", "AAA (SA)", 2.9, 2.9, 2_917_000),
    ("DD3100120.0030030", "vuông", "AAA (SA)", 3.0, 3.0, 2_981_000),
    ("DD3100120.0031031", "vuông", "AAA (SA)", 3.1, 3.1, 3_226_000),
    ("DD3100120.0032032", "vuông", "AAA (SA)", 3.2, 3.2, 3_362_000),
    ("DD3100120.0033033", "vuông", "AAA (SA)", 3.3, 3.3, 2_625_000),
    ("DD3100120.0034034", "vuông", "AAA (SA)", 3.4, 3.4, 2_969_000),
    # KC vuông A (0.9 → 3.4)
    ("DD3100140.0009009", "vuông", "A", 0.9, 0.9, 41_000),
    ("DD3100140.0010010", "vuông", "A", 1.0, 1.0, 49_000),
    ("DD3100140.0011011", "vuông", "A", 1.1, 1.1, 49_000),
    ("DD3100140.0012012", "vuông", "A", 1.2, 1.2, 77_000),
    ("DD3100140.0013013", "vuông", "A", 1.3, 1.3, 85_000),
    ("DD3100140.0014014", "vuông", "A", 1.4, 1.4, 134_000),
    ("DD3100140.0015015", "vuông", "A", 1.5, 1.5, 154_000),
    ("DD3100140.0016016", "vuông", "A", 1.6, 1.6, 166_000),
    ("DD3100140.0017017", "vuông", "A", 1.7, 1.7, 215_000),
    ("DD3100140.0018018", "vuông", "A", 1.8, 1.8, 275_000),
    ("DD3100140.0019019", "vuông", "A", 1.9, 1.9, 316_000),
    ("DD3100140.0020020", "vuông", "A", 2.0, 2.0, 332_000),
    ("DD3100140.0021021", "vuông", "A", 2.1, 2.1, 385_000),
    ("DD3100140.0022022", "vuông", "A", 2.2, 2.2, 442_000),
    ("DD3100140.0023023", "vuông", "A", 2.3, 2.3, 515_000),
    ("DD3100140.0024024", "vuông", "A", 2.4, 2.4, 647_000),
    ("DD3100140.0025025", "vuông", "A", 2.5, 2.5, 1_062_000),
    ("DD3100140.0026026", "vuông", "A", 2.6, 2.6, 1_088_000),
    ("DD3100140.0027027", "vuông", "A", 2.7, 2.7, 1_157_000),
    ("DD3100140.0028028", "vuông", "A", 2.8, 2.8, 1_275_000),
    ("DD3100140.0029029", "vuông", "A", 2.9, 2.9, 1_344_000),
    ("DD3100140.0030030", "vuông", "A", 3.0, 3.0, 1_419_000),
    ("DD3100140.0031031", "vuông", "A", 3.1, 3.1, 1_488_000),
    ("DD3100140.0032032", "vuông", "A", 3.2, 3.2, 1_563_000),
    ("DD3100140.0033033", "vuông", "A", 3.3, 3.3, 1_625_000),
    ("DD3100140.0034034", "vuông", "A", 3.4, 3.4, 2_188_000),
]


def main():
    data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    pl_a8 = {
        "nguon": "PL A8 LSX 01 – Bảng giá thu mua KC tấm, phí mài, mất giấy GIA/PNJ, giám định",
        "phi_mai_kc": PHI_MAI_KC,
        "phi_mai_da_mau": PHI_MAI_DA_MAU,
        "phi_mat_giay_gia": PHI_MAT_GIAY_GIA,
        "gia_kc_tam": [
            {
                "ma": r[0],
                "hinh_dang": r[1],
                "chat_luong": r[2],
                "canh_lon": r[3],
                "canh_nho": r[4],
                "gia": r[5],
            }
            for r in GIA_KC_TAM
        ],
        "ghi_chu": [
            "Giá mài KC áp dụng cho vết trầy/cấn mặt/tim đáy không ảnh hưởng kích thước.",
            "Vết bể/mẻ lớn ảnh hưởng kích thước → phí mài cao hơn, đánh giá theo từng case bởi P.TL&ĐBCL.",
            "PNJ KHÔNG làm lại giấy GIA; chỉ làm lại giấy PNJ Lab.",
            "Phí giám định/ép seal/cấp giấy PNJ Lab: tham khảo bảng PNJL (file riêng).",
        ],
    }
    data["pl_a8"] = pl_a8
    DATA_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK → merged PL A8 into {DATA_PATH}")
    print(f"  phi_mai_kc brackets: {len(PHI_MAI_KC)}")
    print(f"  phi_mat_giay_gia brackets: {len(PHI_MAT_GIAY_GIA)}")
    print(f"  gia_kc_tam entries: {len(GIA_KC_TAM)}")


if __name__ == "__main__":
    main()

"""
Parse giao-an-cs-thu-doi.md → data.json
Output keys:
  - meta (title, updated, LSX)
  - foundation (A1-A8)
  - items (40 DH-xx-yy entries)
  - cases (C1-C14)
  - quick_table (D1.1, D1.2, D1.3)
  - glossary (from A3)

Chạy: python parse_giao_an.py
"""
import json
import re
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
SRC = ROOT / "giao-an-cs-thu-doi.md"
OUT = HERE.parent / "data.json"


def strip_md(s: str) -> str:
    """Bỏ bold **text** và giữ text trong."""
    s = re.sub(r"\*\*(.+?)\*\*", r"\1", s)
    s = re.sub(r"\*(.+?)\*", r"\1", s)
    return s.strip()


def parse_table(lines):
    """Parse markdown table 2 cột | Trường | Nội dung | → dict."""
    result = {}
    for ln in lines:
        if not ln.strip().startswith("|"):
            continue
        cells = [c.strip() for c in ln.strip().strip("|").split("|")]
        if len(cells) != 2:
            continue
        key, val = cells
        if set(key) <= set("-: "):
            continue
        if key.lower() in ("trường", "nhóm hàng", "mã", "stt", "#"):
            if key.lower() == "trường":
                continue
        key_clean = strip_md(key)
        val_clean = val.replace("<br>", "\n").strip()
        result[key_clean] = val_clean
    return result


PERCENT_RE = re.compile(r"(\d{1,3})\s*%")


def extract_rate(text: str):
    """Trích tỷ lệ % từ ô text. Trả về:
        - float 0-1 nếu match rõ 1 số %
        - 'NL' nếu nhắc theo giá nguyên liệu
        - 'NONE' nếu không thu mua
        - 'SPECIAL' nếu case phức tạp (nhiều cond)
        - None nếu không xác định
    """
    if not text:
        return None
    t = strip_md(text)
    tl = t.lower()
    # bullet list → SPECIAL (check trước để không bị "không thu mua" nuốt trường hợp <ngưỡng không mua / ≥ngưỡng mua>)
    bullets = re.findall(r"[•\-]\s*.+", t)
    if len(bullets) >= 2:
        return "SPECIAL"
    # không thu
    if "không thu mua" in tl or "không thu lại" in tl or "không thu/đổi" in tl:
        return "NONE"
    # NL
    if "theo giá nl" in tl or "giá nguyên liệu" in tl or re.match(r"^\s*nl\s*$", tl, re.I):
        return "NL"
    matches = PERCENT_RE.findall(t)
    uniq = set(matches)
    if len(uniq) == 1:
        return int(matches[0]) / 100
    if len(uniq) > 1:
        return "SPECIAL"
    return None


def parse_rate_cell(text: str):
    """Tách tỷ lệ dòng 'THU ... / ĐỔI ...' thành 2 giá trị.
    Nếu không có prefix THU/ĐỔI rõ ràng → coi là giá trị áp cho cả THU và ĐỔI.
    Lưu ý: chỉ match THU/ĐỔI viết HOA (ALL CAPS) để tránh bắt nhầm "thu mua" trong "Không thu mua".
    """
    t = strip_md(text)
    # Chỉ match UPPERCASE THU / ĐỔI (case-sensitive) tại đầu cụm hoặc sau khoảng trắng / dấu /
    thu_m = re.search(r"(?:^|[\s/])THU\b\s*([^/]+?)(?:/|$)", t)
    doi_m = re.search(r"(?:^|[\s/])ĐỔI\b\s*(.+)", t)
    if thu_m or doi_m:
        thu_val = extract_rate(thu_m.group(1)) if thu_m else None
        doi_val = extract_rate(doi_m.group(1)) if doi_m else None
        return thu_val, doi_val
    # Không có prefix → extract toàn bộ cell, áp cho cả 2
    v = extract_rate(t)
    return v, v


def build_item(dh_id: str, title: str, fields: dict) -> dict:
    """Build 1 DH entry chuẩn hoá."""
    item = {
        "id": dh_id,
        "ten": title.strip(),
        "nhom": strip_md(fields.get("Nhóm", "")),
        "dac_diem": fields.get("Đặc điểm nhận diện", ""),
        "pham_vi": fields.get("Phạm vi", ""),
        "cong_thuc": fields.get("Công thức", ""),
        "dieu_kien": fields.get("Điều kiện", ""),
        "phi": fields.get("Phí phát sinh", ""),
        "tham_chieu": fields.get("Tham chiếu", ""),
        "ghi_chu": (
            fields.get("Ghi chú đặc biệt", "")
            or fields.get("Ghi chú ĐẶC BIỆT (quan trọng)", "")
            or fields.get("Ghi chú", "")
        ),
        "vi_du": (
            fields.get("Ví dụ", "")
            or fields.get("Ví dụ 1 (TLV mới < cũ)", "")
            or fields.get("Ví dụ minh họa", "")
        ),
        "raw_fields": fields,
    }
    # Tỷ lệ - nhiều biến thể cấu trúc tuỳ DH
    thu_tr = fields.get("THU trước 05/01/2026")
    doi_tr = fields.get("ĐỔI trước 05/01/2026")
    thu_tu = fields.get("THU từ 05/01/2026")
    doi_tu = fields.get("ĐỔI từ 05/01/2026")

    # Biến thể gộp: "THU" (áp cho cả 2 mốc), "ĐỔI (HĐ trước 05/01/2026)", "ĐỔI (HĐ từ 05/01/2026)"
    thu_generic = fields.get("THU")
    if thu_generic and not thu_tr:
        thu_tr = thu_generic
    if thu_generic and not thu_tu:
        thu_tu = thu_generic
    doi_generic = fields.get("ĐỔI")
    if doi_generic and not doi_tr:
        doi_tr = doi_generic
    if doi_generic and not doi_tu:
        doi_tu = doi_generic
    if not doi_tr:
        doi_tr = fields.get("ĐỔI (HĐ trước 05/01/2026)")
    if not doi_tu:
        doi_tu = fields.get("ĐỔI (HĐ từ 05/01/2026)")
    if not thu_tr:
        thu_tr = fields.get("THU (HĐ trước 05/01/2026)")
    if not thu_tu:
        thu_tu = fields.get("THU (HĐ từ 05/01/2026)")

    ty_le = fields.get("Tỷ lệ")
    ty_le_thu = fields.get("Tỷ lệ THU")
    ty_le_doi = fields.get("Tỷ lệ ĐỔI")
    ty_le_tu = fields.get("Tỷ lệ từ 05/01/2026")

    rates = {
        "thu_truoc": None,
        "doi_truoc": None,
        "thu_tu": None,
        "doi_tu": None,
        "raw": {},
    }
    if thu_tr or doi_tr or thu_tu or doi_tu:
        rates["thu_truoc"] = extract_rate(thu_tr or "")
        rates["doi_truoc"] = extract_rate(doi_tr or "")
        rates["thu_tu"] = extract_rate(thu_tu or "") if thu_tu else rates["thu_truoc"]
        rates["doi_tu"] = extract_rate(doi_tu or "") if doi_tu else rates["doi_truoc"]
        rates["raw"] = {
            "thu_truoc": thu_tr,
            "doi_truoc": doi_tr,
            "thu_tu": thu_tu,
            "doi_tu": doi_tu,
        }
    elif ty_le:
        thu, doi = parse_rate_cell(ty_le)
        rates["thu_truoc"] = thu
        rates["doi_truoc"] = doi
        rates["thu_tu"] = thu
        rates["doi_tu"] = doi
        rates["raw"] = {"ty_le": ty_le}
    elif ty_le_thu or ty_le_doi:
        rates["thu_truoc"] = extract_rate(ty_le_thu or "")
        rates["doi_truoc"] = extract_rate(ty_le_doi or "")
        rates["thu_tu"] = rates["thu_truoc"]
        rates["doi_tu"] = rates["doi_truoc"]
        rates["raw"] = {"ty_le_thu": ty_le_thu, "ty_le_doi": ty_le_doi}
    if ty_le_tu:
        # Override 2 ô "từ 05/01" nếu có field riêng "Tỷ lệ từ 05/01/2026"
        thu_fr, doi_fr = parse_rate_cell(ty_le_tu)
        if thu_fr is not None:
            rates["thu_tu"] = thu_fr
        if doi_fr is not None:
            rates["doi_tu"] = doi_fr
        rates["raw"]["ty_le_tu"] = ty_le_tu

    item["rates"] = rates
    return item


def parse(md: str) -> dict:
    lines = md.split("\n")
    data = {
        "meta": {},
        "foundation": {},
        "items": [],
        "cases": [],
        "quick_table": {},
        "glossary": [],
    }

    # --- META từ block đầu
    head = md.split("---", 1)[0]
    title_m = re.search(r"^#\s+(.+)$", head, re.M)
    if title_m:
        data["meta"]["title"] = title_m.group(1).strip()
    updated_m = re.search(r"Cập nhật lần cuối:\*\*\s*([^–\n]+)", head)
    if updated_m:
        data["meta"]["updated"] = updated_m.group(1).strip()
    lsx_m = re.search(r"PL A2 LSX\s*(\d+)\s*\(hiệu lực từ\s+([^\)]+)\)", head)
    if lsx_m:
        data["meta"]["lsx"] = f"LSX {lsx_m.group(1)} (hiệu lực từ {lsx_m.group(2)})"

    # --- Cắt các vùng Phần A/B/C/D
    def section_range(tag_re):
        m = re.search(tag_re, md)
        return m.start() if m else -1

    pos_a = section_range(r"^## PHẦN A – NỀN TẢNG CHUNG", )
    pos_b = section_range(r"^## PHẦN B – TRA CỨU THEO DÒNG HÀNG")
    pos_c = section_range(r"^## PHẦN C – XỬ LÝ TÌNH HUỐNG")
    pos_d = section_range(r"^## PHẦN D – PHỤ LỤC")

    # Regex multiline
    import re as _re

    pos_a = [m.start() for m in _re.finditer(r"^## PHẦN A", md, _re.M)]
    pos_b = [m.start() for m in _re.finditer(r"^## PHẦN B", md, _re.M)]
    pos_c = [m.start() for m in _re.finditer(r"^## PHẦN C", md, _re.M)]
    pos_d = [m.start() for m in _re.finditer(r"^## PHẦN D", md, _re.M)]
    end = len(md)
    part_a = md[pos_a[0]:pos_b[0]] if pos_a and pos_b else ""
    part_b = md[pos_b[0]:pos_c[0]] if pos_b and pos_c else ""
    part_c = md[pos_c[0]:pos_d[0]] if pos_c and pos_d else ""
    part_d = md[pos_d[0]:] if pos_d else ""

    # --- Foundation: split by ### A1., A2., ...
    a_blocks = _re.split(r"^### (A\d+\.\s+[^\n]+)$", part_a, flags=_re.M)
    # a_blocks: [preamble, 'A1. ...', content, 'A2. ...', content, ...]
    for i in range(1, len(a_blocks), 2):
        title = a_blocks[i].strip()
        content = a_blocks[i + 1].strip() if i + 1 < len(a_blocks) else ""
        key = title.split(".")[0]
        data["foundation"][key] = {"title": title, "content": content}

    # Glossary từ A3 table
    a3 = data["foundation"].get("A3", {}).get("content", "")
    for ln in a3.split("\n"):
        if not ln.strip().startswith("|"):
            continue
        cells = [c.strip() for c in ln.strip().strip("|").split("|")]
        if len(cells) == 4 and cells[0] and not set(cells[0]) <= set("-: "):
            # skip header row
            if cells[0].lower().startswith("viết tắt"):
                continue
            for pair in ((cells[0], cells[1]), (cells[2], cells[3])):
                abbr, full = pair
                if abbr and full and abbr != "Viết tắt":
                    data["glossary"].append({"abbr": strip_md(abbr), "full": strip_md(full)})

    # --- Items: split by #### DH-xx-yy
    dh_regex = _re.compile(r"^#### (DH-\d{2}-\d{2})\s*—\s*(.+?)$", _re.M)
    dh_matches = list(dh_regex.finditer(part_b))
    for idx, m in enumerate(dh_matches):
        start = m.end()
        end_idx = dh_matches[idx + 1].start() if idx + 1 < len(dh_matches) else len(part_b)
        block = part_b[start:end_idx]
        table_lines = []
        for ln in block.split("\n"):
            if ln.strip().startswith("|"):
                table_lines.append(ln)
            elif table_lines and not ln.strip():
                # continue after blank (multi-table?) - skip
                continue
        fields = parse_table(table_lines)
        data["items"].append(build_item(m.group(1), m.group(2), fields))

    # --- Cases: split by ### Cxx.
    c_regex = _re.compile(r"^### (C\d+\.\s*[^\n]+)$", _re.M)
    c_matches = list(c_regex.finditer(part_c))
    for idx, m in enumerate(c_matches):
        start = m.end()
        end_idx = c_matches[idx + 1].start() if idx + 1 < len(c_matches) else len(part_c)
        content = part_c[start:end_idx].strip()
        title = m.group(1).strip()
        cid = title.split(".")[0]
        data["cases"].append({"id": cid, "title": title, "content": content})

    # --- Quick table D1
    d1_m = _re.search(r"^### D1\.[^\n]+", part_d, _re.M)
    if d1_m:
        d1_start = d1_m.end()
        d2_m = _re.search(r"^### D2\.", part_d, _re.M)
        d1_end = d2_m.start() if d2_m else len(part_d)
        data["quick_table"]["raw_md"] = part_d[d1_start:d1_end].strip()

    return data


def main():
    if not SRC.exists():
        print(f"Không tìm thấy {SRC}", file=sys.stderr)
        sys.exit(1)
    md = SRC.read_text(encoding="utf-8")
    data = parse(md)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK → {OUT}")
    print(f"  items: {len(data['items'])}")
    print(f"  cases: {len(data['cases'])}")
    print(f"  foundation: {len(data['foundation'])}")
    print(f"  glossary: {len(data['glossary'])}")


if __name__ == "__main__":
    main()

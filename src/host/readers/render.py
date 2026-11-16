#!/usr/bin/env python3
"""Render an uploaded handout to a self-contained, script-free HTML page."""
import argparse
import base64
from datetime import datetime, timedelta
import html
import mimetypes
import os
import posixpath
import re
import subprocess
import sys
import zipfile
from xml.etree import ElementTree as ET

CSS = """
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; padding: 20px 22px 40px; background: #fff; color: #1f2328;
  font: 15px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif; }
h1 { font-size: 24px; line-height: 1.3; margin: 0 0 16px; }
h2 { font-size: 20px; line-height: 1.35; margin: 26px 0 10px; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; }
h3 { font-size: 17px; margin: 18px 0 8px; }
p { margin: 0 0 10px; white-space: pre-wrap; }
ul, ol { margin: 0 0 12px 22px; padding: 0; }
li { margin: 3px 0; }
pre { white-space: pre-wrap; word-break: break-word; background: #f6f8fa; border: 1px solid #e5e7eb;
  border-radius: 8px; padding: 12px; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
table { border-collapse: collapse; width: 100%; margin: 10px 0 18px; font-size: 13px; }
th, td { border: 1px solid #d8dee4; padding: 6px 8px; text-align: left; vertical-align: top; }
th { background: #f6f8fa; position: sticky; top: 0; }
img { max-width: 100%; height: auto; display: block; margin: 12px 0; border-radius: 4px; }
.slide { border: 1px solid #d8dee4; border-radius: 10px; padding: 14px 16px; margin: 0 0 16px; }
.slide-title { font-size: 12px; color: #6b7280; margin-bottom: 6px; }
.meta { color: #6b7280; font-size: 12px; margin-bottom: 18px; }
@media (prefers-color-scheme: dark) {
  body { background: #1b1f24; color: #e6e8eb; }
  h2 { border-color: #30363d; }
  th, td { border-color: #3b434d; }
  th { background: #242a31; }
  pre { background: #15191e; border-color: #30363d; }
  .slide { border-color: #3b434d; }
}
"""

def esc(value):
    return html.escape(str(value if value is not None else ""), quote=True)

def data_uri(blob, filename):
    mime = mimetypes.guess_type(filename or "")[0] or "application/octet-stream"
    return "data:" + mime + ";base64," + base64.b64encode(blob).decode("ascii")

W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
S_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

def docx_text(node):
    pieces = []
    for child in node.iter():
        if child.tag == W_NS + "t" and child.text:
            pieces.append(child.text)
        elif child.tag == W_NS + "tab":
            pieces.append("\t")
        elif child.tag == W_NS + "br":
            pieces.append("\n")
    return "".join(pieces)

def docx_paragraph(paragraph):
    text = docx_text(paragraph).strip()
    if not text:
        return ""
    style_node = paragraph.find("./" + W_NS + "pPr/" + W_NS + "pStyle")
    style = (style_node.attrib.get(W_NS + "val", "") if style_node is not None else "").lower()
    if style.startswith("heading1") or style == "title":
        return "<h1>" + esc(text) + "</h1>"
    if style.startswith("heading2"):
        return "<h2>" + esc(text) + "</h2>"
    if style.startswith("heading"):
        return "<h3>" + esc(text) + "</h3>"
    return "<p>" + esc(text) + "</p>"

def docx_table(table):
    rows = []
    for row in table.findall(W_NS + "tr"):
        cells = []
        for cell in row.findall(W_NS + "tc"):
            texts = [docx_text(p).strip() for p in cell.findall(W_NS + "p")]
            cells.append("<td>" + esc("\n".join(item for item in texts if item)) + "</td>")
        if cells:
            rows.append("<tr>" + "".join(cells) + "</tr>")
    return ("<table>" + "".join(rows) + "</table>") if rows else ""

def render_docx(path):
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read("word/document.xml"))
        body = root.find(W_NS + "body")
        parts = []
        if body is not None:
            for child in list(body):
                if child.tag == W_NS + "p":
                    parts.append(docx_paragraph(child))
                elif child.tag == W_NS + "tbl":
                    parts.append(docx_table(child))
                elif child.tag == W_NS + "sdt":
                    for nested in child.iter(W_NS + "p"):
                        parts.append(docx_paragraph(nested))
        rels_path = "word/_rels/document.xml.rels"
        names = set(archive.namelist())
        if rels_path in names:
            try:
                rels = ET.fromstring(archive.read(rels_path))
                for rel in rels:
                    if not rel.attrib.get("Type", "").endswith("/image"):
                        continue
                    target = rel.attrib.get("Target", "")
                    name = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join("word", target))
                    if name not in names:
                        continue
                    blob = archive.read(name)
                    if len(blob) <= 10 * 1024 * 1024:
                        parts.append('<img alt="文档图片" src="' + data_uri(blob, name) + '">')
            except Exception:
                pass
    return "".join(parts) or "<p>文档没有可提取的文字。</p>"

def xlsx_shared_strings(archive):
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    values = []
    for item in root.findall(S_NS + "si"):
        values.append("".join(node.text or "" for node in item.iter(S_NS + "t")))
    return values

def xlsx_sheets(archive):
    names = set(archive.namelist())
    rels = {}
    rels_path = "xl/_rels/workbook.xml.rels"
    if rels_path in names:
        try:
            root = ET.fromstring(archive.read(rels_path))
            for rel in root:
                rels[rel.attrib.get("Id", "")] = rel.attrib.get("Target", "")
        except Exception:
            pass
    sheets = []
    if "xl/workbook.xml" in names:
        try:
            root = ET.fromstring(archive.read("xl/workbook.xml"))
            container = root.find(S_NS + "sheets")
            if container is not None:
                for sheet in container.findall(S_NS + "sheet"):
                    target = rels.get(sheet.attrib.get(R_NS + "id", ""), "")
                    if target:
                        path = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join("xl", target))
                        if path in names:
                            sheets.append((sheet.attrib.get("name", "Sheet"), path))
        except Exception:
            pass
    if not sheets:
        for name in sorted(names):
            if re.match(r"xl/worksheets/sheet\d+\.xml$", name):
                sheets.append((posixpath.basename(name), name))
    return sheets

def xlsx_date_styles(archive):
    if "xl/styles.xml" not in archive.namelist():
        return set()
    root = ET.fromstring(archive.read("xl/styles.xml"))
    custom = {}
    formats = root.find(S_NS + "numFmts")
    if formats is not None:
        for item in formats.findall(S_NS + "numFmt"):
            custom[int(item.attrib.get("numFmtId", "0"))] = item.attrib.get("formatCode", "")
    dates = set()
    xfs = root.find(S_NS + "cellXfs")
    if xfs is not None:
        for index, xf in enumerate(xfs.findall(S_NS + "xf")):
            fmt_id = int(xf.attrib.get("numFmtId", "0"))
            code = custom.get(fmt_id, "")
            if 14 <= fmt_id <= 22 or 45 <= fmt_id <= 47 or re.search(r"[ymdhis]", code.lower()):
                dates.add(index)
    return dates

def xlsx_column(ref):
    letters = "".join(ch for ch in str(ref) if ch.isalpha()).upper()
    value = 0
    for ch in letters:
        value = value * 26 + (ord(ch) - 64)
    return max(0, value - 1)

def xlsx_value(cell, shared, date_styles):
    kind = cell.attrib.get("t")
    value = cell.find(S_NS + "v")
    if kind == "inlineStr":
        inline = cell.find(S_NS + "is")
        return "".join(node.text or "" for node in inline.iter(S_NS + "t")) if inline is not None else ""
    if value is None or value.text is None:
        return ""
    raw = value.text
    if kind == "s":
        try:
            return shared[int(raw)]
        except Exception:
            return ""
    if kind == "b":
        return "TRUE" if raw == "1" else "FALSE"
    if kind in ("str", "e"):
        return raw
    style = int(cell.attrib.get("s", "0") or 0)
    if style in date_styles:
        try:
            stamp = datetime(1899, 12, 30) + timedelta(days=float(raw))
            if abs(float(raw) - int(float(raw))) < 1e-6:
                return stamp.strftime("%Y-%m-%d")
            return stamp.strftime("%Y-%m-%d %H:%M")
        except Exception:
            pass
    return raw

def render_xlsx(path):
    with zipfile.ZipFile(path) as archive:
        shared = xlsx_shared_strings(archive)
        dates = xlsx_date_styles(archive)
        parts = []
        for title, sheet_path in xlsx_sheets(archive):
            parts.append("<h2>" + esc(title) + "</h2>")
            try:
                sheet = ET.fromstring(archive.read(sheet_path))
            except Exception:
                parts.append('<p class="meta">工作表无法读取。</p>')
                continue
            rows = []
            truncated = False
            sheet_data = sheet.find(S_NS + "sheetData")
            sheet_rows = sheet_data.findall(S_NS + "row") if sheet_data is not None else []
            for row_index, row in enumerate(sheet_rows):
                if row_index >= 2000:
                    truncated = True
                    break
                values = {}
                for cell in row.findall(S_NS + "c"):
                    index = xlsx_column(cell.attrib.get("r", "A1"))
                    if index >= 80:
                        continue
                    text = xlsx_value(cell, shared, dates)
                    if text != "":
                        values[index] = text
                if values:
                    width = max(values) + 1
                    cells = "<td>" + "</td><td>".join(esc(values.get(i, "")) for i in range(width)) + "</td>"
                    rows.append("<tr>" + cells + "</tr>")
            if rows:
                parts.append("<table>" + "".join(rows) + "</table>")
            else:
                parts.append('<p class="meta">空工作表。</p>')
            if truncated:
                parts.append('<p class="meta">表格超过 2000 行，已截断。</p>')
        return "".join(parts)

def slide_number(name):
    match = re.search(r"slide(\d+)\.xml$", name)
    return int(match.group(1)) if match else 0

def render_pptx(path):
    parts = []
    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
        slides = sorted((name for name in names if re.match(r"ppt/slides/slide\d+\.xml$", name)), key=slide_number)
        for index, slide in enumerate(slides[:100], start=1):
            try:
                root = ET.fromstring(archive.read(slide))
            except Exception:
                continue
            text_nodes = []
            for node in root.iter():
                if node.tag.endswith("}t") and node.text:
                    text_nodes.append(node.text.strip())
            text = "\\n".join(item for item in text_nodes if item)
            rels_name = posixpath.join(posixpath.dirname(slide), "_rels", posixpath.basename(slide) + ".rels")
            images = []
            if rels_name in names:
                try:
                    rels = ET.fromstring(archive.read(rels_name))
                    for rel in rels:
                        target = rel.attrib.get("Target", "")
                        if not rel.attrib.get("Type", "").endswith("/image"):
                            continue
                        media = posixpath.normpath(posixpath.join(posixpath.dirname(slide), target))
                        if media in names:
                            blob = archive.read(media)
                            if len(blob) <= 10 * 1024 * 1024:
                                images.append(data_uri(blob, media))
                except Exception:
                    pass
            parts.append('<section class="slide"><div class="slide-title">Slide ' + str(index) + "</div>")
            if text:
                parts.append("<p>" + esc(text).replace("\\n", "<br>") + "</p>")
            else:
                parts.append('<p class="meta">这一页没有可提取的文字。</p>')
            for image in images:
                parts.append('<img alt="幻灯片图片" src="' + image + '">')
            parts.append("</section>")
    return "".join(parts) or "<p>演示文稿没有可提取的内容。</p>"

def render_doc(path):
    if sys.platform == "darwin":
        try:
            result = subprocess.run(
                ["textutil", "-convert", "txt", "-stdout", path],
                capture_output=True, text=True, timeout=45,
            )
        except Exception as error:
            raise RuntimeError("无法调用 textutil 解析 .doc：" + str(error))
        if result.returncode != 0:
            raise RuntimeError((result.stderr or "textutil 解析失败").strip())
        return "<pre>" + esc(result.stdout) + "</pre>"

    # Windows / Linux: LibreOffice, antiword, then Microsoft Word COM.
    outdir = os.path.join(os.path.dirname(path), "doc-text")
    os.makedirs(outdir, exist_ok=True)
    try:
        subprocess.run(
            ["soffice", "--headless", "--convert-to", "txt:Text", "--outdir", outdir, path],
            capture_output=True, text=True, timeout=90, check=False,
        )
        converted = os.path.join(outdir, os.path.splitext(os.path.basename(path))[0] + ".txt")
        if os.path.exists(converted):
            with open(converted, "r", encoding="utf-8", errors="replace") as handle:
                return "<pre>" + esc(handle.read()) + "</pre>"
    except Exception:
        pass

    try:
        result = subprocess.run(["antiword", path], capture_output=True, text=True, timeout=45)
        if result.returncode == 0 and result.stdout.strip():
            return "<pre>" + esc(result.stdout) + "</pre>"
    except Exception:
        pass

    if sys.platform == "win32":
        try:
            target = os.path.join(outdir, "word-com.txt")
            script = os.path.join(outdir, "word-com.ps1")
            with open(script, "w", encoding="utf-8") as handle:
                handle.write('$w=New-Object -ComObject Word.Application; $w.Visible=$false; $d=$w.Documents.Open($args[0],$false,$true); $d.SaveAs($args[1], 2); $d.Close($false); $w.Quit()')
            subprocess.run(
                ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, path, target],
                capture_output=True, text=True, timeout=90, check=True,
            )
            if os.path.exists(target):
                with open(target, "rb") as handle:
                    raw = handle.read()
                for encoding in ("utf-16", "utf-8-sig", "utf-8", "gbk", "cp1252"):
                    try:
                        return "<pre>" + esc(raw.decode(encoding)) + "</pre>"
                    except UnicodeDecodeError:
                        continue
        except Exception:
            pass

    raise RuntimeError("Windows 解析 .doc 需要 LibreOffice、antiword 或 Microsoft Word；DOCX 不受影响")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--ext", required=True)
    args = parser.parse_args()
    ext = args.ext.lower()
    try:
        if ext == "docx":
            body = render_docx(args.input)
        elif ext == "xlsx":
            body = render_xlsx(args.input)
        elif ext == "pptx":
            body = render_pptx(args.input)
        elif ext == "doc":
            body = render_doc(args.input)
        else:
            raise RuntimeError("不支持的渲染格式：" + ext)
    except ImportError as error:
        raise RuntimeError("缺少 Python 依赖：" + str(error))
    page = "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">" \
           "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" \
           "<style>" + CSS + "</style></head><body><div class=\"meta\">本地讲义阅读器</div>" + body + "</body></html>"
    output = os.path.join(args.out, "render.html")
    with open(output, "w", encoding="utf-8") as handle:
        handle.write(page)
    return 0

if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)

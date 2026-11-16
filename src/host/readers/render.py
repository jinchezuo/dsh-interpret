#!/usr/bin/env python3
"""Render an uploaded handout to a self-contained, script-free HTML page."""
import argparse
import base64
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

def render_docx(path):
    from docx import Document
    doc = Document(path)
    parts = []
    for paragraph in doc.paragraphs:
        text = paragraph.text.strip()
        if not text:
            continue
        style = (paragraph.style.name or "").lower()
        if style.startswith("heading 1") or style == "title":
            parts.append("<h1>" + esc(text) + "</h1>")
        elif style.startswith("heading 2"):
            parts.append("<h2>" + esc(text) + "</h2>")
        elif style.startswith("heading"):
            parts.append("<h3>" + esc(text) + "</h3>")
        else:
            parts.append("<p>" + esc(text) + "</p>")
    for table in doc.tables:
        rows = []
        for row in table.rows:
            cells = "<td>" + "</td><td>".join(esc(cell.text) for cell in row.cells) + "</td>"
            rows.append("<tr>" + cells + "</tr>")
        if rows:
            parts.append("<table>" + "".join(rows) + "</table>")
    for rel in doc.part.rels.values():
        if "image" not in rel.reltype:
            continue
        try:
            blob = rel.target_part.blob
            if len(blob) > 10 * 1024 * 1024:
                continue
            parts.append('<img alt="文档图片" src="' + data_uri(blob, str(rel.target_part.partname)) + '">')
        except Exception:
            pass
    return "".join(parts) or "<p>文档没有可提取的文字。</p>"

def render_xlsx(path):
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    parts = []
    for sheet in wb.worksheets:
        parts.append("<h2>" + esc(sheet.title) + "</h2>")
        rows = []
        for row_index, row in enumerate(sheet.iter_rows(values_only=True)):
            if row_index >= 2000:
                parts.append("<p class=\"meta\">表格超过 2000 行，已截断。</p>")
                break
            values = list(row)[:80]
            cells = "<td>" + "</td><td>".join(esc(value) for value in values) + "</td>"
            rows.append("<tr>" + cells + "</tr>")
        if rows:
            parts.append("<table>" + "".join(rows) + "</table>")
        else:
            parts.append("<p class=\"meta\">空工作表。</p>")
    wb.close()
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

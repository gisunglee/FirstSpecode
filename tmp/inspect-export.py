import zipfile, re

path = 'd:/source/FirstSpecode/tmp/EXPORT_TEST_f2ceae3a.docx'
z = zipfile.ZipFile(path)
print('Files in docx:', len(z.namelist()))
print('Test:', z.testzip() or 'OK')

doc = z.read('word/document.xml').decode('utf-8')
# Extract all visible text
texts = re.findall(r'<w:t[^>]*>([^<]+)</w:t>', doc)
print(f'\n--- Total text runs: {len(texts)} ---')
print('First 40 runs:')
for i, t in enumerate(texts[:40]):
    print(f'  {i:2d}: {t!r}')
print('\n--- Last 20 runs: ---')
for i, t in enumerate(texts[-20:], start=len(texts)-20):
    print(f'  {i:2d}: {t!r}')

print('\n--- Headings/structure ---')
print('TOC field:', 'TOC' in doc and 'fldChar' in doc)
print('Heading1 count:', doc.count('"Heading1"'))
print('Heading2 count:', doc.count('"Heading2"'))
print('Page breaks:', doc.count('w:type="page"'))

print('\n--- Header content ---')
header = z.read('word/header1.xml').decode('utf-8')
header_texts = re.findall(r'<w:t[^>]*>([^<]+)</w:t>', header)
print('Header texts:', header_texts)

print('\n--- Footer content ---')
footer = z.read('word/footer1.xml').decode('utf-8')
footer_texts = re.findall(r'<w:t[^>]*>([^<]+)</w:t>', footer)
print('Footer texts:', footer_texts)

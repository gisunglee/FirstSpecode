import zipfile, re

path = 'd:/source/FirstSpecode/tmp/EXPORT_TEST_f2ceae3a_07-30-58.docx'
z = zipfile.ZipFile(path)
doc = z.read('word/document.xml').decode('utf-8')

print('Tables in document:', doc.count('<w:tbl>'))
print('Heading2 count:', doc.count('"Heading2"'))

# Count text runs that start with '|' — would indicate raw markdown leaked through
pipe_lines = [m.group(1) for m in re.finditer(r'<w:t[^>]*>([^<]+)</w:t>', doc) if m.group(1).startswith('|')]
print('Text runs starting with pipe (raw markdown leak):', len(pipe_lines))
for s in pipe_lines[:5]:
    print('  -', s[:60])

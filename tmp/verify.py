import zipfile
z = zipfile.ZipFile('d:/source/FirstSpecode/tmp/REQ-00023_요구사항명세서.docx')
print('Files:', len(z.namelist()))
print('Test:', z.testzip() or 'OK')
doc = z.read('word/document.xml').decode('utf-8')
print('TOC field present:', 'TOC' in doc and 'fldChar' in doc)
print('Heading1 count:', doc.count('"Heading1"'))
print('Heading2 count:', doc.count('"Heading2"'))
print('Page breaks:', doc.count('w:type="page"'))

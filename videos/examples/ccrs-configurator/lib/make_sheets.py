"""Builds the spreadsheets the "from spreadsheets" pass uploads, from the same
data file the by-hand pass types in, using the configurator's own template
layouts (configurator/src/utils/templateBuilder.ts):

  boundaries.xlsx                     sheet Boundary
  departments-and-designations.xlsx   sheets Department, Designation
  employees.xlsx                      sheet Employee
  complaint-categories.xlsx           sheet ComplaintHierarchy (levels COMPLAINT_TYPE, SUB_TYPE,
                                      which keeps the category editor editable afterwards)

  ../../.venv/bin/python lib/make_sheets.py data/nairobi.json out/sheets
"""
import json
import os
import sys

from openpyxl import Workbook


def sheet(wb, title, header, rows):
    ws = wb.create_sheet(title)
    ws.append(header)
    for row in rows:
        ws.append(row)
    for i, h in enumerate(header):
        width = max([len(str(h))] + [len(str(r[i])) for r in rows if i < len(r)])
        ws.column_dimensions[chr(65 + i)].width = min(48, max(14, width + 2))


def save(wb, path):
    wb.remove(wb['Sheet'])
    wb.save(path)
    print(f'  {path}')


def main(data_path, out_dir):
    data = json.load(open(data_path, encoding='utf-8'))
    here = os.path.dirname(os.path.abspath(data_path))
    os.makedirs(out_dir, exist_ok=True)
    sp = data['spreadsheets']
    dept_code = {d['name']: d['code'] for d in data['departments']}
    desig_code = {d['name']: d['code'] for d in data['designations']}

    # Boundaries: code, name, boundaryType, parentCode, latitude, longitude
    areas = json.load(open(os.path.join(here, sp['boundaries']), encoding='utf-8'))
    wb = Workbook()
    sheet(wb, 'Boundary', ['code', 'name', 'boundaryType', 'parentCode', 'latitude', 'longitude'],
          [[a['code'], a['name'], a['level'], a.get('parent') or '', a.get('lat', ''), a.get('lon', '')] for a in areas])
    save(wb, os.path.join(out_dir, 'boundaries.xlsx'))
    area_code = {}
    for a in areas:
        area_code.setdefault(a['name'], a['code'])

    wb = Workbook()
    sheet(wb, 'Department', ['code', 'name', 'active'], [[d['code'], d['name'], 'true'] for d in data['departments']])
    sheet(wb, 'Designation', ['code', 'name', 'description', 'department', 'active'],
          [[d['code'], d['name'], d.get('description', d['name']), ','.join(dept_code[n] for n in d['departments']), 'true']
           for d in data['designations']])
    save(wb, os.path.join(out_dir, 'departments-and-designations.xlsx'))

    header = ['employeeCode', 'name', 'userName', 'mobileNumber', 'emailId', 'gender', 'dob', 'department',
              'designation', 'roles', 'jurisdictions', 'dateOfAppointment']
    rows = []
    for i, e in enumerate(data['employees']):
        rows.append([
            e.get('bulkCode') or f"{sp.get('employeeCodePrefix', 'EMP_')}{i + sp.get('employeeCodeStart', 2):04d}",
            e['name'], e['email'].split('@')[0], e['mobile'], e['email'], e.get('gender', ''), e.get('dob', ''),
            ','.join(dept_code[n] for n in e['departments']), desig_code[e['designation']],
            ','.join(['EMPLOYEE', *e['roles']]), ','.join(area_code[n] for n in e['jurisdictions']),
            e.get('appointed', ''),
        ])
    wb = Workbook()
    sheet(wb, 'Employee', header, rows)
    save(wb, os.path.join(out_dir, 'employees.xlsx'))

    rows = []
    for cat in data['complaints']['categories']:
        hours = cat.get('hours') or sp.get('defaultResolutionHours', 72)
        for sub in cat['subcategories']:
            rows.append([cat['name'], sub, dept_code[cat['department']], hours, ', '.join(cat.get('keywords', [sub.lower()]))])
    wb = Workbook()
    sheet(wb, 'ComplaintHierarchy', ['COMPLAINT_TYPE', 'SUB_TYPE', 'Department Name*', 'Resolution Time (Hours)*', 'Search Words*'], rows)
    save(wb, os.path.join(out_dir, 'complaint-categories.xlsx'))


if __name__ == '__main__':
    main(*sys.argv[1:3])

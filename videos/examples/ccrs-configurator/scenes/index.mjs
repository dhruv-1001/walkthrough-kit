// Scenes, the passes that record them, and the videos they are joined into.
import account from './01-account.mjs';
import branding from './02-branding.mjs';
import brandingLater from './02b-branding-later.mjs';
import geography from './03-geography.mjs';
import geographyExcel from './03b-geography-excel.mjs';
import geographyFetch from './03c-geography-fetch.mjs';
import departments from './04-departments.mjs';
import departmentsBulk from './04b-departments-bulk.mjs';
import employees from './05-employees.mjs';
import employeesBulk from './05b-employees-bulk.mjs';
import complaints from './06-complaints.mjs';
import complaintsBulk from './06b-complaints-bulk.mjs';

export const SCENES = [
  account, branding, brandingLater, geography, geographyFetch, geographyExcel,
  departments, departmentsBulk, employees, employeesBulk, complaints, complaintsBulk,
];

// Each pass starts from a rewound stack and signs up the same workspace. A
// scene is recorded in the first pass that lists it and only replayed (fast,
// off camera) in later ones. Geography, departments, employees and complaints
// can each be set up only once per workspace, which is why the spreadsheet
// paths need a pass of their own, and Fetch boundaries a third.
export const CHAINS = [
  { id: 'by-hand', scenes: ['account', 'branding', 'geography', 'departments', 'employees', 'complaints'] },
  { id: 'from-spreadsheets', scenes: ['account', 'branding-later', 'geography-excel', 'departments-bulk', 'employees-bulk', 'complaints-bulk'] },
  { id: 'fetch', scenes: ['account', 'branding-later', 'geography-fetch'] },
];

// The deliverables. Scenes are joined in this order; every file ends on the
// documentation outro (a scene's outro is cut when another scene follows it).
export const VIDEOS = [
  { number: 1, id: 'account', slug: '01-setting-up-your-account', scenes: ['account'] },
  { number: 2, id: 'branding', slug: '02-account-branding', scenes: ['branding', 'branding-later'] },
  { number: 3, id: 'geography', slug: '03-defining-your-geography', scenes: ['geography', 'geography-fetch', 'geography-excel'] },
  {
    number: 4, id: 'people', slug: '04-adding-departments-and-employees',
    scenes: ['departments', 'departments-bulk', 'employees', 'employees-bulk'],
    // The Home page has a separate card for each.
    parts: { departments: ['departments', 'departments-bulk'], employees: ['employees', 'employees-bulk'] },
  },
  { number: 5, id: 'complaints', slug: '05-complaints-template', scenes: ['complaints', 'complaints-bulk'] },
];

// Video 1 — Setting up your account: sign up, name and personalise the
// account, create it, then the welcome tour of what onboarding is and Home.
// What can change later (verified on master 5dc402e09): the name, in
// Workspace settings (identity/WorkspacePage.tsx); the account code and URL
// have no change path (WorkspacePage only renames; WorkspaceService.java has
// update = step states, rename = name). After the last step the onboarding
// routes redirect to /manage (App.tsx: inOnboarding), i.e. Management Studio.
import { docsOutro } from './common.mjs';

// Captions for the welcome tour, slide by slide (configurator homeContent.ts:
// welcome, Complaints Template, Branding, Geography, Departments and
// Employees, "You can come back to this"). Several captions per slide are fine.
const SLIDE_CAPTIONS = [
  [
    'Citizens report problems, like a burst pipe or uncollected waste, and the staff responsible pick them up, resolve them and keep the citizen informed.',
    'Onboarding is where you set your account up to make that possible.',
  ],
  ['Complaints Template: what citizens can report, and which department handles each complaint.'],
  ['Branding: your logo, name and look, shown to citizens and employees.'],
  ['Geography: the areas you cover and their levels, such as county, sub-county and ward. Complaints are raised in the smallest areas.'],
  ['Departments and Employees: the teams, the people in them, and the areas each person serves, so every complaint reaches the right person.'],
  ['You can reopen this tour from Home at any time, and every step has documentation on the right.'],
];

export default {
  id: 'account',
  async prepare({ page, base }) {
    await page.goto(`${base}/configurator/login`);
    await page.getByText('Create an account').waitFor();
    await page.waitForLoadState('networkidle').catch(() => {});
  },
  async run({ page, actor, rec, say, settle, data, mail, outroMark }) {
    const { founder, account } = data;
    await say('# Setting up your account');
    await actor.pause(1500);
    await say('New to the Complaint Management System? Create an account from the sign-in page.');
    await actor.click(page.getByText('Create an account'));
    await page.getByRole('heading', { name: 'Verify your email to begin' }).waitFor();
    await actor.pause(500);

    await say('First, verify your email. Enter your name and work email.');
    await actor.type(page.getByLabel('First name'), founder.firstName);
    await actor.type(page.getByLabel('Last name'), founder.lastName);
    await actor.type(page.getByLabel('Email address'), founder.email, { delay: 40 });
    await say('We email you a secure link.');
    const sentAt = Date.now();
    await actor.click(page.getByRole('button', { name: 'Email me a sign-in link' }));
    await page.getByRole('heading', { name: 'Check your email' }).waitFor();
    await say('Open the link in that email to continue.');
    await actor.pause(1500);
    await settle();
    await rec.cut(async () => {
      const { link } = await mail.waitForLink(founder.email, { since: sentAt, match: /login-actions\/action-token/ });
      await page.goto(link);
      await page.getByRole('heading', { name: 'Set up your account' }).waitFor({ timeout: 60000 });
      await page.waitForLoadState('networkidle').catch(() => {});
    });

    await say('Your email is verified. Now name your account.');
    await actor.type(page.getByLabel('Account name'), account.name);
    await actor.pause(600);
    await say('You can change the name later, in Workspace settings.');
    await actor.pause(600);
    await say('The account code is a short identifier for your account. It can’t be changed later.');
    await actor.type(page.getByLabel('Account code'), account.code, { delay: 70 });
    await page.getByText('Available.').first().waitFor();
    await actor.pause(900);
    await actor.click(page.getByRole('button', { name: 'Continue' }));
    await page.getByRole('heading', { name: 'Personalise your account' }).waitFor();
    await actor.pause(500);

    await say('Choose your base country. It sets the timezone and the mobile number format.');
    const country = page.locator('#countryCode');
    await actor.hover(country);
    await country.selectOption(account.country);
    await actor.pause(900);
    await actor.hover(page.locator('#timeZone'));
    await actor.pause(700);
    // English starts picked (SignupPage.tsx); data.account.languages adds others.
    await say('Pick the languages your citizens and staff will use. English is already picked.');
    await actor.hover(page.getByRole('button', { name: 'English', exact: true }));
    await actor.pause(700);
    for (const lang of account.languages ?? []) await actor.click(page.getByRole('button', { name: lang, exact: true }), { after: 300 });
    if (account.financialYear) {
      await say('And your financial year.');
      const fy = page.locator('#financialYearPolicy');
      await actor.hover(fy);
      await fy.selectOption({ label: account.financialYear });
      await actor.pause(700);
    }
    await say('The account URL is the short name in the web addresses of your citizen and employee apps. It can’t be changed later either.');
    await actor.type(page.locator('#urlSlug'), account.slug, { delay: 80 });
    await page.getByText('Available.').first().waitFor();
    await actor.pause(600);
    await say('Your mobile number creates your own user inside the new account.');
    await actor.type(page.locator('#tenantAdminMobile'), account.mobile);
    await page.locator('#tenantAdminMobile').blur();
    await actor.pause(900);
    await actor.click(page.getByRole('button', { name: 'Continue' }));
    await page.getByRole('heading', { name: 'Review and create your account' }).waitFor();

    await say('Review the details and create the account.');
    await actor.hover(page.getByText('Account name', { exact: true }));
    await actor.pause(1800);
    await actor.click(page.getByRole('button', { name: 'Create account' }));
    await say('Your workspace is being set up. This usually takes a minute or two.');
    await actor.pause(1500);
    await settle(); // finish the line on the setup screen, before the wait is cut
    await rec.cut(async () => {
      await page.waitForURL(/\/onboarding\/home/, { timeout: 300000 });
      await page.getByRole('dialog').waitFor({ timeout: 60000 });
      await page.waitForLoadState('networkidle').catch(() => {});
    });

    await say('The first time you arrive, a short tour explains how everything fits together.');
    await actor.pause(1200);
    const dialog = page.getByRole('dialog');
    for (const [i, lines] of SLIDE_CAPTIONS.entries()) {
      for (const text of lines) {
        await say(text);
        await actor.pause(i === 0 ? 1500 : 1200);
        await settle();
      }
      if (i < SLIDE_CAPTIONS.length - 1) await actor.click(dialog.getByRole('button', { name: 'Next' }), { after: 500 });
    }
    await say('Five steps, one after another.');
    await actor.click(dialog.getByRole('button', { name: 'Get started' }), { after: 800 });

    await say('Home shows how far you are, and the step to do next.');
    await actor.hover(page.getByRole('heading', { name: 'Branding', exact: true }).first());
    await actor.pause(1500);
    await say('The steps unlock in order, from Branding to the Complaints Template.');
    for (const step of ['Branding', 'Geography', 'Departments', 'Employees', 'Complaints Template']) {
      await actor.hover(page.getByRole('button', { name: new RegExp(`^${step}\\b`) }).first());
      await actor.pause(350);
    }
    await actor.pause(600);
    await say('Until you finish, you can go back to any step you’ve done.');
    await actor.pause(1200);
    await say('Once setup is finished, you make changes in Management Studio instead.');
    await actor.pause(1200);
    await say('Short videos on each step are here whenever you need them.');
    await actor.hover(page.getByText('Learn the basics'));
    await actor.pause(2000);
    await say('Take a tour reopens the welcome tour.');
    await actor.hover(page.getByRole('button', { name: 'Take a tour' }));
    await actor.pause(1200);
    await say('Next: set up your branding.');
    await actor.hover(page.getByRole('button', { name: /^Set up Branding/i }).first());
    await actor.pause(1500);
    await docsOutro({ page, actor, say, outroMark });
  },
};

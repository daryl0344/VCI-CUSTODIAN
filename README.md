# VCI CUSTODIAN — Sports Equipment Borrowing and Return System

A frontend-only web application for **Veritas College of Irosin** that manages sports equipment inventory, student borrowing requests, equipment issuance, returns and transaction records.

- **Project owner:** Daryl G. Melitante
- **Course / Section:** BSIT 3A
- **Instructor:** Sir Emarve Gito

## Technologies used
HTML, CSS and vanilla JavaScript only. Data is saved with the browser's `localStorage`.
No frameworks, backend, API or database are used in this first-semester version.

## Folder structure
```text
VCI-CUSTODIAN/
├── index.html   page structure (the app shell and the login/register templates)
├── style.css    all styling
├── script.js    all JavaScript (storage layer, service layer, pages, router)
├── images/      logo and equipment pictures (logo, equipment pictures and `equipment-placeholder.png`)
└── README.md
```
Screens are routes inside the page (`#/login`, `#/admin`, `#/inventory`, `#/borrowing`, `#/returns`, `#/transactions`, ...), so back/forward buttons work.

## How to run (Visual Studio Code + Live Server)
1. Install the **Live Server** extension in VS Code.
2. Open the `VCI-CUSTODIAN` folder (File → Open Folder).
3. Right-click `index.html` → **Open with Live Server**.
4. The app opens in your browser (usually `http://127.0.0.1:5500/index.html`).

You can also double-click `index.html` to open it directly.
To try it on a cellphone, connect the phone to the same Wi-Fi and open `http://<your-laptop-IP>:5500/`.

## Administrator account (demonstration login)
| Username | Password |
|---|---|
| `admin` | `admin123` |

This is a **demonstration account for the school project**. The first time the system opens in a browser that has no Admin account, it creates `admin` / `admin123` automatically. Because the password is visible in `script.js` and in this README, **anyone who reads the code can log in as Admin. This is not secure and must never be used for a real deployment.** Real authentication needs a backend (second semester).

- An Admin account that already exists in the browser is kept as it is. It is never replaced or overwritten.
- The Admin can change the password from **Dashboard → Admin security**. There is no interface for creating more Admin accounts, and student registration can never create an Admin.
- **Reset Demo Data** keeps the Admin account and its password.

## Students: register and log in
1. On the login page click **Register as Student**.
2. Fill in Student ID, complete name, course, year level, username, password and confirm password. The **Review your details** panel shows what you entered.
3. Click **Create Account**. You are logged in automatically and taken to the Student Dashboard.
4. Next time, log in with your username and password.

## Borrowing workflow
**Student submits request → Admin approves or rejects → Admin issues the equipment → Student returns it (any time) → Admin verifies and confirms the return.**

- Submitting or approving a request does **not** change stock. An identical request (same student, equipment, quantity and dates) that is still Pending or Approved is refused, so double clicks cannot create duplicates.
- Stock is deducted **once**, when the Admin clicks **Issue** (a second issue is blocked).
- On return, only items in **Good** condition go back to available stock. **Damaged** and **Needs Repair** items stay out of available stock (they are counted under "Damaged/repair units").
- Partial returns are supported; the request stays open until every unit is back.
- A request whose due date has passed and is not fully returned is shown as **Overdue**. A fully returned request is never overdue.
- Tip for demos: when issuing, the Admin may enter a past issue date and a past return date to show an overdue item.

## Returning equipment (students)
1. Open **My Requests**. Every request that is **Borrowed** or **Overdue** has a **Return** button. A student may return equipment at any time, even before the due date, in full or in part.
2. The system stamps the actual return **date and time**. The return is saved as **Pending Verification**; stock does not change yet and the request stays open.
3. The Admin opens **Returns** (the sidebar shows how many are waiting), checks the equipment and chooses **Confirm return** (setting the condition after inspection) or **Not received**.
4. Only on confirmation does stock change. Units confirmed as **Good** go back to Available; **Damaged** or **Needs Repair** units stay out of available stock.
5. A second return for the same units is blocked while one is pending, and a confirmed return cannot be confirmed again. Every step is recorded in **Transactions** and in the Returns records table.

## Security in this version
- Admin-only functions check the logged-in account inside the service layer (`requireAdmin()`), not just on the screen. Students can only act on their own records, and the student's identity always comes from the session.
- All submitted data is validated in the service functions before anything is saved.
- 5 wrong passwords for a username lock that username for 5 minutes. Sessions end after 30 minutes without activity.
- **Forgotten Admin password:** while logged in, the Admin can generate a one-time **recovery code** (Dashboard → Admin security). It is shown once and only a scrambled copy is stored. On the login page, **Forgot the Admin password?** accepts the code and sets a new password. If no code was ever generated, the only way back in is to clear this browser's saved data, which deletes all records and lets you set up a new Admin account.
- These checks still run in the user's own browser, so a person with browser developer tools can bypass them. See the next section.

## What a real backend and database need
The current project has no server and no database. To make these features trustworthy for real use, the minimum is:
- **A server** (Node.js/Express, PHP/Laravel or similar) that exposes the service-layer functions as authenticated endpoints: `submitReturn`, `confirmReturn`, `rejectReturn`, `recordReturn`, plus the existing borrowing, inventory and login functions.
- **A database** (MySQL/PostgreSQL) with tables for users, equipment, borrow_requests, issuances, returns (with status and timestamps) and transactions. Stock changes and the related record updates must run inside one database transaction so they cannot get out of step.
- **Server-side authentication:** passwords hashed with bcrypt or argon2, sessions or tokens with expiry, and role checks on every admin endpoint. Password reset should use an email or the school's IT process instead of a code kept in the browser.

## Code organization (backend-ready)
The `<script>` in `index.html` is divided into sections:
1. **Constants and helpers**
2. **Storage layer** — the only code that touches `localStorage` (`loadList`, `saveList`)
3. **Service layer** — all rules and data operations: `getAccounts()`, `saveAccount()`, `getEquipment()`, `saveEquipment()`, `getBorrowingRequests()`, `saveBorrowingRequest()`, `issueEquipment()`, `recordReturn()`, `getTransactions()`, and more
4. **UI helpers** (toast, modal, sidebar)
5. **Page controllers** (one function per screen) and the **router**

In the second semester, replace the bodies of the service-layer functions with `fetch()` calls to a backend API. The page controllers only call service functions, so the interface can stay almost unchanged (add `async/await`).

## How localStorage works
`localStorage` is a small storage area inside your browser. Because the pictures are embedded in `index.html`, only your data is stored there. This app saves these keys: `vci_accounts`, `vci_equipment`, `vci_requests`, `vci_issuances`, `vci_returns`, `vci_transactions`, `vci_counters`, `vci_login_guard`. Data stays after refreshing or closing the browser. You can inspect it in the browser's DevTools → Application → Local Storage. Sample equipment is created only if no inventory data exists, so your records are not overwritten when the app opens.

## Important data and security limitations
- Data is saved **in one browser on one device only**. Accounts created on a laptop will **not** appear on a cellphone. There is no synchronization.
- Clearing browser data (or using private/incognito mode) deletes accounts and records.
- Different browsers on the same computer have separate data.
- Login is for demonstration only. Passwords are stored in the browser with a simple non-secure scrambling function, and anyone with access to the browser can read or edit the data. **This is not secure enough for a real system.**
- Role checks (students cannot open Admin pages, students only see their own records) are done in JavaScript only and can be bypassed by someone who knows how. A real deployment needs backend authentication, server-side authorization, secure password hashing (bcrypt/argon2) and database validation.
- Equipment pictures uploaded by the Admin are resized and saved inside localStorage, which has a limit of roughly 5 MB.

## Equipment: categories, images and permissions
- **Categories.** When adding or editing equipment the admin picks a category chip (the selected one turns green): Basketball, Volleyball, Badminton, Football, Track and Field, Athletics, Table Tennis, Sepak Takraw, Other Sports. **+ Custom category** lets the admin type another one. Names are tidied and matched without regard to capital letters, so "pickleball" and "PICKLEBALL" become one category. The inventory shows the category on each card and has category chips (with counts) plus search and availability filters.
- **Images are optional, with a placeholder.** Equipment can be saved with no picture. A record with no picture, or whose picture cannot be loaded, shows the local `images/equipment-placeholder.png` instead of a broken icon. (To show nothing instead, make `imgTag()` in `script.js` return an empty string when `src` is empty.) Pictures are chosen from the files in `images/` or uploaded by the admin. The logo is a plain `<img src="images/vci-logo.jpg" alt="VCI-CUSTODIAN Logo">`.
- **Only the admin can add, edit or delete equipment.** Students can browse and borrow. The check is made inside the add / edit / delete functions, not only by hiding buttons. Deleting asks for confirmation and is refused while the equipment is borrowed or has a pending or approved request.

## Student forgot the password
1. On the login page the student clicks **Forgot password?**, chooses **I am a student**, and sees what to do (the same link also has **I am the Admin** for the admin recovery code).
2. The student goes to the Sports Custodian. The Admin opens **Dashboard → Student accounts**, searches the student, checks who they are, and clicks **Reset password**.
3. A temporary password is shown **once**. The Admin gives it to the student. Only a scrambled copy is stored, and the reset also removes a "too many attempts" lock.
4. At the next login the student must enter the temporary password and choose a new one. It cannot be skipped.
Students can also change their own password any time from **Dashboard → My account**. Because data lives in one browser, the reset must be done in the same browser where the student registered. Real email-based recovery needs the semester-2 backend.

## Why the dashboard shows 170 (and how to change it)
A browser that has never saved inventory starts with **13 sample equipment records** (basketballs, volleyballs, nets, shuttlecocks, cones and so on). Their quantities add up to 12 + 10 + 2 + 8 + 2 + 16 + 24 + 12 + 40 + 2 + 6 + 6 + 30 = **170 physical items** (older versions showed 162 with 10 records). So that number is the sum of the *sample* quantities, not a counting mistake. To show your real inventory, open **Inventory → Edit** on each sample item and type the real quantity (or **Delete** the samples you do not have and **Add equipment** for the ones you do). Nothing is deleted automatically. **Reset Demo Data** brings the sample numbers back, so do not use it once you have entered real data.

## When does "Borrowed Equipment" go up?
Only when the Admin clicks **Issue**. Submitting a request (Pending) and approving it (Approved) do **not** change the numbers, because the equipment is still on the shelf. The Admin Dashboard shows a yellow notice for requests waiting for review and for approved requests that are not issued yet, and a **Currently borrowed equipment** table (equipment, borrower, quantity out, date borrowed, expected return, status, Details) for everything that has been issued and not fully returned. The Borrowed card separates *units out* from *active transactions*.

## Dashboard counts
All numbers are calculated from the same equipment list that the Inventory page shows, every time the dashboard opens.
- **Total Equipment** = physical items (the sum of all quantities). The line under it shows how many equipment records exist.
- **Available Equipment** = items that can be borrowed right now. Borrowed, damaged, under-repair and unavailable items are not counted. The line under it shows how many items are out of service.
- Total = Available + Currently Borrowed + Out of service.

## Changing pictures (logo and equipment)
All picture file names are written in **`index.html`**, so you can change them without touching the JavaScript.
1. Copy your `.png` or `.jpg` file into the `images/` folder.
2. Open `index.html` and change the file name in the matching `src="images/..."` line.
   - Logo: `<template id="tpl-brand">` (sidebar) and the two logo lines inside `tpl-login` and `tpl-register`. The browser-tab icon is the `<link rel="icon" ...>` line at the top.
   - Equipment pictures: the `<div id="equipment-pictures">` block. These are the choices in the **Image** list when the admin adds or edits equipment, and the pictures used by the sample equipment. To add one, copy a line and change `src` and `alt`.
3. Equipment already saved in your browser keeps the picture it was saved with. Open **Edit** and choose the new picture.
4. Equipment pictures are optional. With no picture, `images/equipment-placeholder.png` is shown.

## Where to find things (for studying the code)
**index.html** (about 120 lines): the page skeleton, the picture list, and the Login and Register templates.

**style.css**: colors and sizes are variables at the top (`:root`). The rest is grouped by part of the screen: sidebar, tables, cards, forms, modals, chips and badges.

**script.js**: read it from top to bottom. It is organized in five numbered sections:
| Section | What is inside |
|---|---|
| 1. Constants and helpers | Lists such as categories, statuses and conditions, date and text helpers |
| 2. Storage layer | The only code that reads or writes `localStorage` |
| 3. Service layer | The rules: accounts and sessions, admin password, equipment, borrowing requests, issuing, **returns** (student return, admin verify), transactions |
| 4. UI helpers | Toast messages, modal windows, badges, the sidebar and top bar |
| 5. Page controllers | One function per page: login, register, admin and student dashboards, inventory (with the add/edit form), borrowing, returns, transactions and reports, and the router at the end |

Tip: search the file for `function submitReturn` (student returns), `function confirmReturn` (admin verifies), `function addEquipment`, `function deleteEquipment` and `function cleanCategory` to follow each feature from the screen down to the rule.

## Design and layout (style.css)
- Colors, sizes and shadows are variables at the top of `style.css` (`:root`). Change the green there and the whole site follows.
- The file is numbered in sections: basics, buttons, forms, login, sidebar and top bar, cards and dashboard, equipment cards, status badges, tables, modal and notifications, and responsive rules (tablet at 900px, phone at 640px).
- Sidebar icons and dashboard icons are small inline SVG drawings kept in `ICON_PATHS` inside `script.js` (section 4). The active page is marked by the `.active` link in the sidebar.
- Summary cards are built by the `statCard()` helper. Their numbers are always calculated from the saved data, never typed in.
- An equipment picture is drawn only when the saved value is a real image (`hasImage()`); a broken picture hides its box.
- Important actions ask first with `confirmAction()` (log out, approve, cancel request, delete equipment, reset demo data). Messages appear as small notifications (`toast()`).
- On phones, tables become stacked cards (the `data-label` text shows before each value).

## Reset demonstration data
Log in as Admin → **Dashboard** → scroll to **Demo data** → **Reset Demo Data** → confirm. This deletes all locally stored student accounts, requests, returns and transactions, and restores the sample equipment. The Admin account is kept.

## Reports
Admin → **Transactions & Reports** → **Reports** tab: choose a report (inventory, available, borrowed, overdue, requests, returned, transactions) to view it on screen. 

### Printing a report
1. Choose a report, then click **Print Report**. The browser's print window opens (`window.print()`).
2. Only the report is printed: the sidebar, menus, tabs and buttons are hidden. The page shows *Veritas College of Irosin*, the system name, the report title and the date, then the table (A4 landscape, header row repeats on every page).
3. To make a PDF, choose **Save as PDF** as the printer. No PDF library is used.

## Suggested improvements for the second semester
- Backend (Node.js/Express, PHP/Laravel or similar) with REST API endpoints matching the service-layer functions.
- Database (MySQL/PostgreSQL) with tables: users, equipment, borrow_requests, issuances, returns, transactions.
- Real authentication: hashed passwords, sessions or JWT, server-side role checks.
- Email/SMS or in-app notifications for approvals and overdue items.
- Student ID verification against the school records, and a custodian password-reset process.
- Equipment photo upload to server storage, barcode/QR codes for equipment, and penalty/fine tracking.
- Audit logs and database backups.

## Testing checklist (how to test by hand)
1. Open with Live Server. Log in as `admin` / `admin123`.
2. Register a student (second browser tab or after logging out). Try a duplicate Student ID or username: it must be refused.
3. As student: request equipment. Stock must **not** change. As admin: **Approve**, then **Issue**: stock drops once (a second Issue is refused).
4. As student: **Return** some units. As admin (**Returns**): confirm with *Good* (stock comes back) or *Damaged / Needs Repair* (stays unavailable).
5. Check **Transactions & Reports**, then **Print Report**.
6. Make the window narrow (phone width) and check the menu button, tables and forms.
7. **Reset Demo Data** and confirm that the sample equipment returns and the Admin still logs in.

Each browser and each device has its **own** storage. Accounts created on a laptop will not appear on a phone.

## If equipment pictures do not show
- The pictures must stay in the `images/` folder next to `index.html` (do not move or rename them).
- Older saved inventory may have lost the sample pictures. The system now repairs this **once**: sample items (matched by exact name, for example *Basketball*) get their picture back. Uploaded pictures are never changed, and a picture you remove later stays removed.
- You can always set a picture yourself: **Inventory → Edit → Picture**.

## Equipment pictures (current set)
All pictures are in `images/` (lowercase file names, about 640 px wide, all `.jpg`): `basketball`, `volleyball`, `volleyball-net`, `soccer-ball`, `soccer-net`, `badminton-racket`, `shuttlecock`, `table-tennis-paddle`, `table-tennis-ball`, `table-tennis-net`, `takraw`, `whistle`, `training-cones`, plus `vci-logo.jpg` and `equipment-placeholder.png`. There is no generic sports-net picture. The picture list the *Edit equipment* form offers is the `#equipment-pictures` block in `index.html`. To change a picture, replace the file in `images/` (same name) or edit that list.

**Inventory already saved in a browser:** a one-time repair runs the first time this version opens.
- The old **Sports Net** record becomes **Volleyball Net** (same record, same quantity, its history is kept), and **Soccer Net**, **Table Tennis Net** and **Takraw** are added (2, 2 and 6 units; change them in Inventory → Edit).
- Sample items get their new picture. An old *Football* item keeps its name but gets the soccer-ball picture (rename it in Edit if you want *Soccer Ball*).
- Uploaded pictures are never changed, and a picture you remove later stays removed.

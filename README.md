# Faculty Match

Faculty Match is a lightweight, browser-based tool for preparing student-to-faculty allocations from CSV files. It is a static site: there is no sign-in or server-side processing.

## Use the site

Open `index.html` in a modern browser, or deploy this repository to Netlify. Upload one student CSV and one faculty CSV, choose the exclusion and allocation rules, review the preview, then export the result as CSV.

The files are read and processed in the browser. They are not sent to a Faculty Match server. Avoid using a shared or public computer for student records, and close the page when finished.

## CSV formats

Save files as UTF-8 CSV with a header row. Header names are case-insensitive; the required names are:

**Students**

```csv
name,usn,cgpa,section
Ananya Rao,1AB23IS001,9.2,A
```

**Faculty**

```csv
name,id,subject
Dr Meera Nair,F001,Data Structures
```

Student USNs and faculty IDs must be present and unique. Student CGPA must be between 0 and 10. Names, sections, and subjects must not be blank. Each file is limited to 5 MB.

## Available rules

- Exclude the top N students department-wide, top N within each section, or a top department-wide percentage, ranked by CGPA.
- At a CGPA cutoff, either include all tied students or keep the exact requested count.
- Allocate remaining students with equal group sizes, section balancing, CGPA balancing, or by keeping sections together.
- Allocation is deterministic for the same input rows and settings, with faculty ID used to break allocation ties.
- Export assigned and excluded students with their allocation or exclusion reason.

The current prototype does not extract data from CVs, edit parsed records, manually reassign students, or save an audit history. It has no user accounts or shared database.

## Deploy to Netlify

This is a static site with no build step. Connect the GitHub repository to Netlify and use the repository root (`.`) as the publish directory. The included `netlify.toml` provides that setting. Every push to the connected branch can trigger a new deploy.

## Project files

- `index.html` — page structure and controls
- `styles.css` — responsive day and night themes
- `app.js` — CSV validation, allocation logic, preview, and export
- `netlify.toml` — static Netlify publish settings


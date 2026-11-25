function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.length === 0) quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(value => value.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  row.push(cell);
  if (row.some(value => value.trim() !== '')) rows.push(row);
  if (!rows.length) throw new Error('The CSV file is empty.');
  const headers = rows.shift().map(value => value.trim().replace(/^\uFEFF/, '').toLowerCase());
  if (new Set(headers).size !== headers.length) throw new Error('The CSV has duplicate column names.');
  return rows.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`Row ${index + 2} has ${values.length} values; expected ${headers.length}.`);
    return Object.fromEntries(headers.map((header, i) => [header, values[i].trim()]));
  });
}

function validateRoster(students, faculty) {
  if (!students.length) throw new Error('Add at least one student.');
  if (!faculty.length) throw new Error('Add at least one faculty member.');
  const unique = (records, key, label) => {
    const ids = records.map(record => record[key]);
    if (ids.some(value => !value)) throw new Error(`${label} records need a non-empty ${key.replace('_', ' ')}.`);
    if (new Set(ids).size !== ids.length) throw new Error(`${label} IDs must be unique.`);
  };
  unique(students, 'usn', 'Student'); unique(faculty, 'id', 'Faculty');
  students.forEach((student, i) => {
    const cgpa = Number(student.cgpa);
    if (!student.name) throw new Error(`Student row ${i + 1} needs a name.`);
    if (!student.section) throw new Error(`Student row ${i + 1} needs a section.`);
    if (!Number.isFinite(cgpa) || cgpa < 0 || cgpa > 10) throw new Error(`Student ${student.usn} needs a CGPA from 0 to 10.`);
    student.cgpa = cgpa;
  });
  faculty.forEach((person, i) => { if (!person.name) throw new Error(`Faculty row ${i + 1} needs a name.`); if (!person.subject) throw new Error(`Faculty row ${i + 1} needs a subject.`); });
}

const byId = (a, b) => a.usn.localeCompare(b.usn, undefined, {numeric:true, sensitivity:'base'});
function rankByCgpa(a, b) { return b.cgpa - a.cgpa || byId(a, b); }

function calculate(students, faculty, settings) {
  validateRoster(students, faculty);
  const {excludeMode, amount, tieMode, allocationMode} = settings;
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount < 0) throw new Error('Exclusion value must be zero or greater.');
  if (excludeMode !== 'percentage' && !Number.isInteger(numericAmount)) throw new Error('Top N must be a whole number.');
  if (excludeMode === 'percentage' && numericAmount > 100) throw new Error('Exclusion percentage must be 100 or less.');
  let excludedIds = new Set();
  const selectTop = (group, count) => {
    const ranked = [...group].sort(rankByCgpa);
    if (count <= 0 || !ranked.length) return;
    const cutoff = ranked[Math.min(Math.ceil(count), ranked.length) - 1]?.cgpa;
    if (cutoff === undefined) return;
    ranked.forEach((student, index) => { if (index < count || (tieMode === 'include' && student.cgpa === cutoff)) excludedIds.add(student.usn); });
  };
  if (excludeMode === 'department' || excludeMode === 'section') {
    const target = excludeMode === 'department' ? Math.ceil(numericAmount) : numericAmount;
    if (excludeMode === 'department') selectTop(students, target);
    else [...new Set(students.map(s => s.section))].sort().forEach(section => selectTop(students.filter(s => s.section === section), target));
  } else if (excludeMode === 'percentage') selectTop(students, Math.ceil(students.length * Math.min(numericAmount, 100) / 100));
  else throw new Error('Choose a valid student exclusion method.');

  const eligible = students.filter(s => !excludedIds.has(s.usn));
  const groups = faculty.map(person => ({faculty:person, students:[], sections:{}, cgpaTotal:0}));
  const ordered = [...eligible].sort(rankByCgpa);
  if (allocationMode === 'keep_sections' && eligible.length) {
    const buckets = [...new Set(eligible.map(student => student.section))].sort().map(section => ({section, students:eligible.filter(student => student.section === section), facultyCount:1, facultyGroups:[]}));
    if (faculty.length < buckets.length) throw new Error(`Keep sections together needs at least one faculty member for each of the ${buckets.length} sections with eligible students.`);
    while (buckets.reduce((total, bucket) => total + bucket.facultyCount, 0) < faculty.length) {
      buckets.sort((a,b) => (b.students.length / b.facultyCount) - (a.students.length / a.facultyCount) || a.section.localeCompare(b.section));
      buckets[0].facultyCount++;
    }
    buckets.sort((a,b) => a.section.localeCompare(b.section));
    const sortedFaculty = [...groups].sort((a,b) => a.faculty.id.localeCompare(b.faculty.id));
    let offset = 0;
    for (const bucket of buckets) {
      bucket.facultyGroups = sortedFaculty.slice(offset, offset + bucket.facultyCount);
      bucket.facultyGroups.forEach(group => { group.section = bucket.section; });
      offset += bucket.facultyCount;
      for (const student of [...bucket.students].sort(rankByCgpa)) {
        const target = [...bucket.facultyGroups].sort((a,b) => a.students.length - b.students.length || a.faculty.id.localeCompare(b.faculty.id))[0];
        target.students.push(student); target.sections[student.section] = (target.sections[student.section]||0)+1; target.cgpaTotal += student.cgpa;
      }
    }
  } else {
    for (const student of ordered) {
      const sorted = [...groups].sort((a,b) => {
        if (allocationMode === 'equal') return a.students.length - b.students.length || a.faculty.id.localeCompare(b.faculty.id);
        if (allocationMode === 'section') return (a.sections[student.section]||0) - (b.sections[student.section]||0) || a.students.length - b.students.length || a.faculty.id.localeCompare(b.faculty.id);
        if (allocationMode === 'cgpa') return a.cgpaTotal - b.cgpaTotal || a.students.length - b.students.length || a.faculty.id.localeCompare(b.faculty.id);
        if (allocationMode === 'keep_sections') return 0;
        throw new Error('Choose a valid faculty allocation method.');
      });
      const target = sorted[0];
      target.students.push(student); target.sections[student.section] = (target.sections[student.section]||0)+1; target.cgpaTotal += student.cgpa;
    }
  }
  const assignments = groups.flatMap(group => group.students.map(student => ({
    ...student, faculty_id:group.faculty.id, faculty_name:group.faculty.name, faculty_subject:group.faculty.subject,
    reason: allocationMode === 'equal' ? 'Assigned to the currently smallest group.' : allocationMode === 'section' ? `Assigned to balance section ${student.section} representation.` : allocationMode === 'cgpa' ? 'Assigned to the group with the lowest cumulative CGPA.' : `Assigned to a faculty group reserved for section ${student.section}.`
  })));
  const excluded = students.filter(s => excludedIds.has(s.usn)).map(student => ({...student, reason:excludeMode === 'section' ? `Top ${numericAmount} in section ${student.section} by CGPA.` : excludeMode === 'percentage' ? `Top ${numericAmount}% department-wide by CGPA.` : `Top ${Math.ceil(numericAmount)} department-wide by CGPA.`}));
  return {assignments, excluded, groups:groups.map(g => ({faculty_id:g.faculty.id, faculty_name:g.faculty.name, faculty_subject:g.faculty.subject, section:g.section || null, count:g.students.length, averageCgpa:g.students.length ? g.cgpaTotal/g.students.length : null}))};
}

function toCsv(result) {
  const rows = [['status','name','usn','cgpa','section','faculty_name','faculty_id','subject','reason']];
  result.assignments.forEach(s => rows.push(['assigned',s.name,s.usn,s.cgpa,s.section,s.faculty_name,s.faculty_id,s.faculty_subject,s.reason]));
  result.excluded.forEach(s => rows.push(['excluded',s.name,s.usn,s.cgpa,s.section,'','','',s.reason]));
  return rows.map(row => row.map(value => `"${String(value ?? '').replaceAll('"','""')}"`).join(',')).join('\r\n');
}

const $ = selector => document.querySelector(selector);
let students = [], faculty = [], result = null, activeFilter = 'assigned', tieMode = 'include', sortDirection = 'asc';
const inputError = $('#input-error');
const themeButton = $('#theme-toggle');
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const dark = theme !== 'light';
  themeButton.textContent = dark ? '☀' : '☾';
  themeButton.setAttribute('aria-label', dark ? 'Switch to day mode' : 'Switch to night mode');
  themeButton.title = dark ? 'Switch to day mode' : 'Switch to night mode';
  try { localStorage.setItem('faculty-match-theme', theme); } catch {}
}
let savedTheme = 'light';
try { const stored = localStorage.getItem('faculty-match-theme'); savedTheme = stored && stored !== 'light' ? 'dark' : 'light'; } catch {}
setTheme(savedTheme);
themeButton.addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
function showError(message='') { inputError.textContent = message; inputError.hidden = !message; }
async function loadFile(input, kind) {
  showError();
  const file = input.files?.[0]; if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showError('Keep each CSV under 5 MB.'); input.value=''; return; }
  try {
    const records = parseCsv(await file.text());
    const required = kind === 'students' ? ['name','usn','cgpa','section'] : ['name','id','subject'];
    const missing = required.filter(key => !(key in records[0]));
    if (missing.length) throw new Error(`Missing ${kind === 'students' ? 'student' : 'faculty'} column${missing.length>1?'s':''}: ${missing.join(', ')}.`);
    if (kind === 'students') students = records; else faculty = records;
    $(`#${kind === 'students' ? 'student' : 'faculty'}-file-name`).textContent = `${file.name} · ${records.length} rows`;
    $('#file-status').textContent = students.length && faculty.length ? 'FILES LOADED' : 'ONE FILE LOADED';
    updatePreview();
  } catch (error) { showError(error.message); input.value=''; }
}
$('#students-file').addEventListener('change', event => loadFile(event.target,'students'));
$('#faculty-file').addEventListener('change', event => loadFile(event.target,'faculty'));
$('#exclude-mode').addEventListener('change', () => {
  const percentage = $('#exclude-mode').value === 'percentage';
  $('#amount-label').textContent = percentage ? 'Percentage of students' : $('#exclude-mode').value === 'section' ? 'Number per section' : 'Number of students';
  $('#amount-suffix').textContent = percentage ? '%' : 'students'; $('#exclude-amount').max = percentage ? '100' : ''; $('#exclude-amount').step = percentage ? '0.1' : '1';
  updatePreview();
});
$('#exclude-amount').addEventListener('input', updatePreview);
$('#allocation-mode').addEventListener('change', updatePreview);
$('#calculate-button').addEventListener('click', updatePreview);
document.querySelectorAll('[data-tie]').forEach(button => button.addEventListener('click', () => {
  tieMode = button.dataset.tie; document.querySelectorAll('[data-tie]').forEach(el => el.classList.toggle('selected',el===button)); updatePreview();
}));
function updatePreview() {
  showError();
  $('#student-count').textContent = students.length || '—'; $('#faculty-count').textContent = faculty.length || '—';
  if (!students.length || !faculty.length) { result=null; $('#excluded-count').textContent='—'; $('#group-list').innerHTML=emptyState(); $('#preview-state').textContent='Waiting for files'; $('#export-button').disabled=true; $('#audit').hidden=true; return; }
  try {
    result = calculate(students.map(s=>({...s})),faculty.map(f=>({...f})),{excludeMode:$('#exclude-mode').value,amount:$('#exclude-amount').value||0,tieMode,allocationMode:$('#allocation-mode').value});
    $('#excluded-count').textContent=result.excluded.length; $('#preview-state').textContent=`${result.assignments.length} assigned · ${result.excluded.length} shortlisted`;
    const max = Math.max(1,...result.groups.map(g=>g.count));
    $('#group-list').innerHTML=result.groups.map(group=>`<div class="faculty-group"><div class="group-head"><span class="faculty-name">${escapeHtml(group.faculty_name)} <span style="color:#9ba69f;font-weight:400">· ${escapeHtml(group.faculty_id)}</span></span><span class="group-count">${group.count} ${group.count===1?'student':'students'}</span></div><div class="group-meta">${group.section?`Section ${escapeHtml(group.section)} · `:''}${escapeHtml(group.faculty_subject)} · ${group.averageCgpa===null?'No students assigned':`Average CGPA ${group.averageCgpa.toFixed(2)}`}</div><div class="group-meter"><span style="width:${Math.round(group.count/max*100)}%"></span></div></div>`).join('') || emptyState();
    $('#export-button').disabled=false; $('#audit').hidden=false; renderDecisions();
  } catch(error) { result=null; $('#excluded-count').textContent='—'; $('#group-list').innerHTML=emptyState(); $('#preview-state').textContent='Check file data'; $('#export-button').disabled=true; $('#audit').hidden=true; showError(error.message); }
}
function emptyState(){return '<div class="empty-state"><div class="empty-illustration"><span></span><span></span><span></span><i>↗</i></div><b>Your preview will appear here</b><p>Upload both files and choose your allocation rules.</p></div>';}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
function renderDecisions(){
  if(!result)return;
  $('#assigned-total').textContent=result.assignments.length; $('#excluded-total').textContent=result.excluded.length;
  const assigned=activeFilter==='assigned';
  if(!assigned && ['faculty','subject'].includes($('#sort-mode').value)) $('#sort-mode').value='section';
  $('#sort-mode').querySelector('[value="faculty"]').disabled=!assigned;
  $('#sort-mode').querySelector('[value="subject"]').disabled=!assigned;
  $('#decision-head').innerHTML=assigned?'<tr><th>STUDENT / USN</th><th>CGPA</th><th>SECTION</th><th>STATUS</th><th>FACULTY</th><th>SUBJECT</th></tr>':'<tr><th>STUDENT / USN</th><th>CGPA</th><th>SECTION</th><th>STATUS</th></tr>';
  const key=$('#sort-mode').value;
  const records=[...(activeFilter==='assigned'?result.assignments:result.excluded)];
  records.sort((a,b)=>{
    const left=key==='cgpa'?Number(a.cgpa):String(key==='faculty'?a.faculty_name||'':key==='subject'?a.faculty_subject||'':a.section||'');
    const right=key==='cgpa'?Number(b.cgpa):String(key==='faculty'?b.faculty_name||'':key==='subject'?b.faculty_subject||'':b.section||'');
    const compare=typeof left==='number'?left-right:left.localeCompare(right,undefined,{numeric:true,sensitivity:'base'});
    return (sortDirection==='asc'?compare:-compare) || a.usn.localeCompare(b.usn,undefined,{numeric:true,sensitivity:'base'});
  });
  $('#sort-direction').textContent=key==='cgpa'?(sortDirection==='asc'?'Low–high ↑':'High–low ↓'):(sortDirection==='asc'?'A–Z ↑':'Z–A ↓');
  $('#decision-rows').innerHTML=records.map(s=>`<tr><td><b>${escapeHtml(s.name)}</b><br><span style="color:#94a099">${escapeHtml(s.usn)}</span></td><td>${Number(s.cgpa).toFixed(2)}</td><td>${escapeHtml(s.section)}</td><td><span class="status-pill ${activeFilter==='excluded'?'excluded':''}">${activeFilter==='assigned'?'Assigned':'Shortlisted'}</span></td>${assigned?`<td>${escapeHtml(s.faculty_name)}</td><td>${escapeHtml(s.faculty_subject)}</td>`:''}</tr>`).join('');
}
document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{activeFilter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(el=>el.classList.toggle('active',el===button));renderDecisions();}));
$('#sort-mode').addEventListener('change',()=>renderDecisions());
$('#sort-direction').addEventListener('click',()=>{sortDirection=sortDirection==='asc'?'desc':'asc';renderDecisions();});
$('#export-button').addEventListener('click',()=>{if(!result)return;const blob=new Blob(['\ufeff',toCsv(result)],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='faculty-match-allocation.csv';link.click();URL.revokeObjectURL(url);});
$('#download-template').addEventListener('click',()=>{
 const entries=[['students-template.csv','name,usn,cgpa,section\nAarav Sharma,1CR24IS133,8.4,A\n'],['faculty-template.csv','name,id,subject\nDr. Sample Faculty,F001,Database Management Systems\n']];
 entries.forEach(([name,content])=>{const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([content],{type:'text/csv'}));link.download=name;link.click();URL.revokeObjectURL(link.href);});
});
$('#allocation-mode').addEventListener('change',()=>{
 $('#strategy-hint').textContent={equal:'Keeps group sizes as even as possible, with a stable faculty ID tie-break.',section:'Greedily places each student with the fewest peers from the same section, then the smallest group.',keep_sections:'Keeps each faculty group within one section. A section can use multiple faculty to keep groups near the same size.',cgpa:'Greedily assigns to the group with the lowest cumulative CGPA, then the smallest group.'}[$('#allocation-mode').value];
});

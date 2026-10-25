const fs = require('fs');
let content = fs.readFileSync('public/js/admin.js', 'utf8');

// Replace Loading States
content = content.replace(/([a-zA-Z0-9_]+)\.innerHTML\s*=\s*'<tr><td colspan=\"(\d+)\"[^>]*>Loading([^<]*)<\/td><\/tr>';/g, (match, el, colspan, msg) => {
    return `${el}.innerHTML = UI.Table.loadingRow({ colspan: ${colspan}, message: 'Loading${msg}' });`;
});

// Replace Empty States (No ...)
content = content.replace(/([a-zA-Z0-9_]+)\.innerHTML\s*=\s*'<tr><td colspan=\"(\d+)\"[^>]*>No([^<]*)<\/td><\/tr>';/g, (match, el, colspan, msg) => {
    return `${el}.innerHTML = UI.Table.emptyRow({ colspan: ${colspan}, message: 'No${msg}' });`;
});

// Replace Failed States
content = content.replace(/([a-zA-Z0-9_]+)\.innerHTML\s*=\s*'<tr><td colspan=\"(\d+)\"[^>]*text-error[^>]*>Failed([^<]*)<\/td><\/tr>';/g, (match, el, colspan, msg) => {
    return `${el}.innerHTML = UI.Table.errorRow({ colspan: ${colspan}, message: 'Failed${msg}' });`;
});

fs.writeFileSync('public/js/admin.js', content);
console.log('Regex replacements applied.');

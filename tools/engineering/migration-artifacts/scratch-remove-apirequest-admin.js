const fs = require('fs');

let adminJs = fs.readFileSync('public/js/admin.js', 'utf8');

const regex = /\/\/\s*API Helper utility\s*async function apiRequest[\s\S]*?throw error;\s*\}\s*\}/m;

adminJs = adminJs.replace(regex, '');

fs.writeFileSync('public/js/admin.js', adminJs);
console.log('Successfully removed apiRequest from admin.js');

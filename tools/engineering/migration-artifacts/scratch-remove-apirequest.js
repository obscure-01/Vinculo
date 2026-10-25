const fs = require('fs');

function removeApiRequest(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');

    // We'll use a regex to match the async function apiRequest definition
    // It looks like:
    // async function apiRequest(url, options = {}) {
    //     ...
    //     return data;
    // }
    
    const apiReqRegex = /\/\/\s*Helper to make authenticated API requests[\s\S]*?async function apiRequest\([\s\S]*?return data;\s*\}/m;
    
    // Also, the regex might miss the catch block or some parts if not perfectly matched.
    // Let's use string manipulation if it's simpler, or a more robust regex.
    // Let's just find the start of the function and the end by parsing bracket depth.
    
    const startIdx = content.indexOf('async function apiRequest(url, options = {}) {');
    if (startIdx === -1) {
        console.log(`No apiRequest found in ${filePath}`);
        return;
    }
    
    // Remove the comment before it if present
    let actualStart = startIdx;
    const commentStr = '// Helper to make authenticated API requests';
    const commentIdx = content.lastIndexOf(commentStr, startIdx);
    if (commentIdx !== -1 && (startIdx - commentIdx) < 100) {
        actualStart = commentIdx;
    }

    let depth = 0;
    let endIdx = -1;
    for (let i = startIdx; i < content.length; i++) {
        if (content[i] === '{') depth++;
        if (content[i] === '}') {
            depth--;
            if (depth === 0) {
                endIdx = i + 1;
                break;
            }
        }
    }
    
    if (endIdx !== -1) {
        content = content.substring(0, actualStart) + content.substring(endIdx);
        fs.writeFileSync(filePath, content);
        console.log(`Successfully removed apiRequest from ${filePath}`);
    } else {
        console.log(`Failed to find end of apiRequest in ${filePath}`);
    }
}

removeApiRequest('public/js/student.js');
removeApiRequest('public/js/admin.js');

const fs = require('fs');
const path = require('path');

function fixMojibake(filePath) {
    try {
        const fullPath = path.resolve(filePath);
        const content = fs.readFileSync(fullPath, 'utf8');
        
        // Attempt automatic fix: convert string to Buffer using latin1 (misinterpreted encoding)
        // then convert back to string using utf8.
        try {
            const buf = Buffer.from(content, 'latin1');
            const fixedContent = buf.toString('utf8');
            
            // Check if it's actually improved (e.g. contains fewer garbage sequences)
            // A simple heuristic: if the number of multi-byte characters is restored.
            if (fixedContent !== content && !fixedContent.includes('')) {
                fs.writeFileSync(fullPath, fixedContent, 'utf8');
                console.log(`Successfully fixed ${filePath} via re-encoding`);
                return;
            }
        } catch (e) {
            console.log(`Auto-fix failed for ${filePath}: ${e.message}`);
        }

        // Manual fallback if auto-fix doesn't look right
        const replacements = {
            'ðŸ“¥': '📥',
            'ðŸ“¤': '📤',
            'ðŸ“‹': '📋',
            'âœ–': '✖',
            'âœ”': '✔',
            'âœ‰ï¸': '✉️',
            'ðŸ“§': '📧',
            'âœ…': '✅',
            'â ±ï¸': '⏱️',
            'â†©ï¸': '↩️',
            'ðŸŽŸï¸': '🎟️',
            'ðŸ’Ž': '💎',
            'ðŸ †': '🏆',
            'ðŸ ›ï¸': '🏛️',
            'â “': '❓',
            'âš¡': '⚡',
            'ðŸ“…': '📅',
            'â€”': '—',
            'â€¢': '•',
            'ðŸ›¡': '🛡️',
            'ðŸŒŸ': '🌟',
            'ðŸŽ®': '🎮',
            'ðŸ”¥': '🔥',
            'ðŸ’°': '💰',
            'Ã‚': '',
            'â€“': '–',
            'â€˜': '‘',
            'â€™': '’',
            'â€œ': '“',
            'â€': '”'
        };

        let newContent = content;
        Object.entries(replacements).forEach(([old, replacement]) => {
            newContent = newContent.split(old).join(replacement);
        });

        if (newContent !== content) {
            fs.writeFileSync(fullPath, newContent, 'utf8');
            console.log(`Applied manual fixes to ${filePath}`);
        } else {
            console.log(`No changes made to ${filePath}`);
        }

    } catch (err) {
        console.error(`Error processing ${filePath}: ${err.message}`);
    }
}

const files = process.argv.slice(2);
files.forEach(fixMojibake);

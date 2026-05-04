import sys

def fix_mojibake(file_path):
    try:
        # Read the file as UTF-8
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Try to fix it by encoding as latin-1 and decoding as utf-8
        # This reverses the "read as utf-8, interpret as latin-1, save as utf-8" process
        try:
            fixed_content = content.encode('latin-1').decode('utf-8')
            print(f"Successfully fixed {file_path}")
            
            # Write it back as pure UTF-8 (no BOM)
            with open(file_path, 'w', encoding='utf-8', newline='') as f:
                f.write(fixed_content)
        except (UnicodeEncodeError, UnicodeDecodeError) as e:
            print(f"Failed to fix {file_path} automatically: {e}")
            # Fallback: manual replacements for common patterns if auto-fix fails
            replacements = {
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
                'ðŸ’Ž': '💎',
                'Ã‚': '', # Often an artifact of double encoding
            }
            new_content = content
            for old, new in replacements.items():
                new_content = new_content.replace(old, new)
            
            if new_content != content:
                with open(file_path, 'w', encoding='utf-8', newline='') as f:
                    f.write(new_content)
                print(f"Applied manual fixes to {file_path}")
            else:
                print(f"No changes made to {file_path}")

    except Exception as e:
        print(f"Error handling {file_path}: {e}")

if __name__ == "__main__":
    for path in sys.argv[1:]:
        fix_mojibake(path)

$files = @(
    "client\src\pages\HomePage.js",
    "client\src\pages\HomePage.css"
)

$replacements = @{
    "ðŸŸ¢" = "🟢"
    "ðŸª™" = "🪙"
    "ï¿½" = "🔀"
    "ðŸ“‹" = "📋"
    "âœ…" = "✅"
    "â ³" = "⏳"
    "âœ–" = "✖"
    "ðŸ“¤" = "📤"
    "ðŸ“¥" = "📥"
    "â ±ï¸ " = "⏳"
    "â†©ï¸ " = "↩️"
    "ðŸŽŸï¸ " = "🎟️"
    "ðŸ’Ž" = "💎"
    "ðŸ †" = "🏆"
    "ðŸ ›ï¸ " = "🛡️"
    "â “" = "❓"
    "â–²" = "▲"
    "â–¼" = "▼"
    "â†’" = "→"
    "â€“" = "–"
    "â€”" = "—"
    "â€¦" = "…"
    "â€¢" = "•"
}

foreach ($file in $files) {
    if (Test-Path $file) {
        Write-Host "Processing $file..."
        $content = Get-Content $file -Raw -Encoding UTF8
        foreach ($key in $replacements.Keys) {
            $content = $content.Replace($key, $replacements[$key])
        }
        # Special case for some other patterns seen in grep
        $content = $content -replace 'o-', '✖'
        $content = $content -replace 'o\.', '✅'
        $content = $content -replace '\?"', '❓'
        
        Set-Content $file $content -Encoding UTF8
    }
}

#!/bin/bash
# Export all active cycles from Fireberry

source /home/opc/clawd/skills/fireberry/.env
OUTPUT_DIR="/home/opc/clawd/projects/haitech-crm/migration/data"
mkdir -p "$OUTPUT_DIR"

echo "Exporting active cycles from Fireberry..."

# Export all active cycles with full details
> "$OUTPUT_DIR/active_cycles.json"
echo "[" >> "$OUTPUT_DIR/active_cycles.json"
FIRST=true

for page in 1 2 3 4 5; do
  curl -s "https://api.fireberry.com/api/record/1000?pagesize=500&pagenumber=$page" \
    -H "tokenid: $FIREBERRY_TOKEN" | \
    jq -c '.data.Records[] | select(.pcfsystemfield37name == "פעיל")' | while read -r cycle; do
    if [ "$FIRST" = true ]; then
      FIRST=false
    else
      echo "," >> "$OUTPUT_DIR/active_cycles.json"
    fi
    echo "$cycle" >> "$OUTPUT_DIR/active_cycles.json"
  done
done

echo "]" >> "$OUTPUT_DIR/active_cycles.json"

# Create a summary file
jq -r '.[] | [.customobject1000id, .name, .pcfsystemfield268name, .pcfsystemfield270, .pcfsystemfield85name, .pcfsystemfield28name, .pcfsystemfield451name, .pcfsystemfield233, .pcfsystemfield550] | @tsv' "$OUTPUT_DIR/active_cycles.json" > "$OUTPUT_DIR/cycles_summary.tsv"

echo "Exported to $OUTPUT_DIR/active_cycles.json"
echo "Summary in $OUTPUT_DIR/cycles_summary.tsv"
wc -l "$OUTPUT_DIR/cycles_summary.tsv"

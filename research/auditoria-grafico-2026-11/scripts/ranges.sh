cd "$1"
for r in "1A D" "2A D" "5A D" "MAX D" "5A W" "MAX M" "1M D" "1A 1H"; do set -- $r; 
 out=$(curl -s -b cj.txt -o c_$1_$2.json -w "t=%{time_total}s size=%{size_download}" "http://localhost:3320/api/chart?symbol=KO&range=$1&interval=$2")
 echo -n "KO range=$1 int=$2 $out "; node -e 'const d=require(process.argv[1]);const b=d.bars||[];console.log("bars",b.length,b[0]&&b[0].date,"->",b.at(-1)&&b.at(-1).date, d.dataQuality&&d.dataQuality.source)' "$PWD/c_$1_$2.json"; done

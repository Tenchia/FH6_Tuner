import urllib.request
import re
import json

def fetch_and_parse():
    url = 'https://raw.githubusercontent.com/ForzaMods/FH5-Car-ID-List/main/README.md'
    req = urllib.request.Request(url)
    req.add_header('User-Agent', 'Mozilla/5.0')
    
    print("Downloading FH5 Car Database from GitHub...")
    with urllib.request.urlopen(req) as response:
        content = response.read().decode('utf-8')
        
    cars = {}
    
    # Matches rows like: | Ferrari 599XX | 1171 |
    pattern = re.compile(r'\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|')
    
    for line in content.split('\n'):
        match = pattern.search(line)
        if match:
            name = match.group(1).strip()
            car_id = match.group(2).strip()
            # Ignore headers
            if car_id.isdigit():
                cars[car_id] = name
                
    with open('cars.json', 'w', encoding='utf-8') as f:
        json.dump(cars, f, indent=4, ensure_ascii=False)
        
    print(f"Successfully saved {len(cars)} cars to cars.json!")

if __name__ == '__main__':
    fetch_and_parse()

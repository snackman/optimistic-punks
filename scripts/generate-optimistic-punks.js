const Jimp = require('jimp');
const fs = require('fs');
const path = require('path');

const SPRITE_SIZE = 24;
const PUNKS_COLS = 100;
const PUNKS_ROWS = 100;
const SPRITESHEET_COLS = 25;
const TOTAL_PUNKS = 10000;

// Smile sprite ID for males
const MALE_SMILE_SPRITE_ID = 362;

// Y coordinate: 7 from bottom = 24 - 7 = 17 (0-indexed from top)
const SMILE_Y = 17;

// Female mouth color positions to sample from (on base sprite)
// The mouth on female bases is around y=18, x=12-13
const FEMALE_MOUTH_SAMPLE_Y = 18;
const FEMALE_MOUTH_SAMPLE_X = 12;

// Female base sprite IDs by skin tone
const FEMALE_BASE_IDS = {
  'Light': 24,
  'Medium': 23,
  'Dark': 22,
  'Albino': 25,
};

// Male base sprite IDs by skin tone
const MALE_BASE_IDS = {
  'Light': 7,
  'Medium': 6,
  'Dark': 5,
  'Albino': 8,
};

// Frown pixels to remove (relative to punk position)
// The frown adds black pixels at the mouth corners curving down
const FROWN_PIXELS = [
  {x: 10, y: 19},  // left corner of frown (going down from mouth)
  {x: 15, y: 20},  // right corner of frown (going down from mouth)
];

// Parse CSV manually
function parseCSV(content) {
  const lines = content.split('\n').filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim());
  const records = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // Split by comma but be careful with the accessories field
    const parts = line.split(',');
    const record = {};
    record.id = parts[0].trim();
    record.type = parts[1].trim();
    record.gender = parts[2].trim();
    record.skinTone = parts[3].trim();
    record.count = parts[4].trim();
    // Accessories are everything after the 5th comma
    record.accessories = parts.slice(5).join(',').trim();
    records.push(record);
  }

  return records;
}

async function main() {
  console.log('Loading images...');

  const punksComposite = await Jimp.read(path.join(__dirname, '../data/punks.png'));
  const spriteSheet = await Jimp.read(path.join(__dirname, '../data/cryptopunks-assets/punks/config/punks-24x24.png'));

  console.log('Loading punk data...');
  const csvPath = path.join(__dirname, '../data/punks-attributes/original/cryptopunks.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const records = parseCSV(csvContent);

  // Build punk data map
  const punks = {};
  for (const record of records) {
    const id = parseInt(record.id);
    const accessories = record.accessories
      ? record.accessories.split('/').map(a => a.trim()).filter(a => a)
      : [];
    punks[id] = {
      id,
      gender: record.gender,
      skinTone: record.skinTone,
      accessories,
      hasSmile: accessories.includes('Smile'),
      hasFrown: accessories.includes('Frown'),
    };
  }

  // Extract female mouth colors from base sprites
  console.log('Sampling female mouth colors...');
  const femaleMouthColors = {};
  for (const [skinTone, spriteId] of Object.entries(FEMALE_BASE_IDS)) {
    const row = Math.floor(spriteId / SPRITESHEET_COLS);
    const col = spriteId % SPRITESHEET_COLS;

    const color = spriteSheet.getPixelColor(
      col * SPRITE_SIZE + FEMALE_MOUTH_SAMPLE_X,
      row * SPRITE_SIZE + FEMALE_MOUTH_SAMPLE_Y
    );
    const rgba = Jimp.intToRGBA(color);
    femaleMouthColors[skinTone] = rgba;
    console.log(`  ${skinTone}: RGB(${rgba.r}, ${rgba.g}, ${rgba.b})`);
  }

  // Extract male skin colors from base sprites (for frown removal)
  console.log('Sampling male skin colors...');
  const maleSkinColors = {};
  for (const [skinTone, spriteId] of Object.entries(MALE_BASE_IDS)) {
    const row = Math.floor(spriteId / SPRITESHEET_COLS);
    const col = spriteId % SPRITESHEET_COLS;

    // Sample from cheek area (x=10, y=15) which is reliable skin
    const color = spriteSheet.getPixelColor(
      col * SPRITE_SIZE + 10,
      row * SPRITE_SIZE + 15
    );
    const rgba = Jimp.intToRGBA(color);
    maleSkinColors[skinTone] = rgba;
    console.log(`  ${skinTone}: RGB(${rgba.r}, ${rgba.g}, ${rgba.b})`);
  }

  // Extract smile sprite
  console.log('Extracting smile sprite...');
  const smileRow = Math.floor(MALE_SMILE_SPRITE_ID / SPRITESHEET_COLS);
  const smileCol = MALE_SMILE_SPRITE_ID % SPRITESHEET_COLS;
  const smileSprite = spriteSheet.clone().crop(
    smileCol * SPRITE_SIZE,
    smileRow * SPRITE_SIZE,
    SPRITE_SIZE,
    SPRITE_SIZE
  );

  // Create output composite
  console.log('Creating optimistic punks composite...');
  const outputImage = punksComposite.clone();

  let malesWithoutSmile = 0;
  let malesWithSmile = 0;
  let malesWithFrown = 0;
  let femalesCount = 0;

  for (let punkId = 0; punkId < TOTAL_PUNKS; punkId++) {
    if (punkId % 1000 === 0) {
      console.log(`Processing punk ${punkId}...`);
    }

    const punk = punks[punkId];
    if (!punk) {
      console.warn(`No data for punk ${punkId}`);
      continue;
    }

    // Calculate position in composite
    const row = Math.floor(punkId / PUNKS_COLS);
    const col = punkId % PUNKS_COLS;
    const dstX = col * SPRITE_SIZE;
    const dstY = row * SPRITE_SIZE;

    const isMale = punk.gender === 'Male';
    const isFemale = punk.gender === 'Female';

    if (isMale) {
      // Remove frown if present
      if (punk.hasFrown) {
        const skinColor = maleSkinColors[punk.skinTone];
        if (skinColor) {
          for (const fp of FROWN_PIXELS) {
            outputImage.setPixelColor(
              Jimp.rgbaToInt(skinColor.r, skinColor.g, skinColor.b, 255),
              dstX + fp.x,
              dstY + fp.y
            );
          }
        }
        malesWithFrown++;
      }

      if (punk.hasSmile) {
        // Already has smile - add black pixel at (15, 17)
        const pixelX = dstX + 15;
        const pixelY = dstY + SMILE_Y;
        outputImage.setPixelColor(Jimp.rgbaToInt(0, 0, 0, 255), pixelX, pixelY);
        malesWithSmile++;
      } else {
        // No smile - overlay the smile sprite
        // Composite the smile sprite onto the punk
        for (let sy = 0; sy < SPRITE_SIZE; sy++) {
          for (let sx = 0; sx < SPRITE_SIZE; sx++) {
            const spriteColor = smileSprite.getPixelColor(sx, sy);
            const rgba = Jimp.intToRGBA(spriteColor);
            // Only draw non-transparent pixels
            if (rgba.a > 0) {
              outputImage.setPixelColor(spriteColor, dstX + sx, dstY + sy);
            }
          }
        }
        malesWithoutSmile++;
      }
    } else if (isFemale) {
      // Add mouth-colored pixel at (10, 17)
      const mouthColor = femaleMouthColors[punk.skinTone];
      if (mouthColor) {
        const pixelX = dstX + 10;
        const pixelY = dstY + SMILE_Y;
        outputImage.setPixelColor(
          Jimp.rgbaToInt(mouthColor.r, mouthColor.g, mouthColor.b, 255),
          pixelX,
          pixelY
        );
      }
      femalesCount++;
    }
  }

  console.log('\nStats:');
  console.log(`  Males without smile (added smile sprite): ${malesWithoutSmile}`);
  console.log(`  Males with smile (added black pixel): ${malesWithSmile}`);
  console.log(`  Males with frown (removed frown pixels): ${malesWithFrown}`);
  console.log(`  Females (added mouth pixel): ${femalesCount}`);

  // Save output
  const outputPath = path.join(__dirname, '../data/optimistic-punks.png');
  await outputImage.writeAsync(outputPath);
  console.log(`\nSaved: ${outputPath}`);
}

main().catch(console.error);

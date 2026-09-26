// Loads backend/products.json into the products table.
// Run this once to get started, and again any time you hand-edit products.json
// and want those changes reflected in the database.
//
// Usage: npm run seed

const fs = require('fs');
const path = require('path');
const db = require('./database');

const productsPath = path.join(__dirname, 'products.json');
const products = JSON.parse(fs.readFileSync(productsPath, 'utf8'));

const upsert = db.prepare(`
  INSERT INTO products (id, name, description, price, image, active)
  VALUES (@id, @name, @description, @price, @image, 1)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    description = excluded.description,
    price = excluded.price,
    image = excluded.image
`);

const insertMany = db.transaction((items) => {
  for (const item of items) upsert.run(item);
});

insertMany(products);

console.log(`Seeded ${products.length} product(s) into store.db`);

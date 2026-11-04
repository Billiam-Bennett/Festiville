import { test } from "node:test";
import assert from "node:assert/strict";
import { TRUCK, sanitizeTruck } from "../shared/truck-data.js";
import { sanitizeListing } from "../shared/listings.js";

test("sanitizeTruck: defaults collapse to null, custom designs are cleaned", () => {
  assert.equal(sanitizeTruck(null), null);
  assert.equal(sanitizeTruck(TRUCK.defaults), null);                          // nothing changed → nothing stored
  const t = sanitizeTruck({ body: "#ABCDEF", awning: "nope", topper: "taco", junk: 1 });
  assert.equal(t.body, "#abcdef");                                            // lowercased
  assert.equal(t.awning, TRUCK.defaults.awning);                             // bad color → default
  assert.equal(t.topper, "taco");
  assert.equal(t.junk, undefined);                                           // unknown keys dropped
  assert.equal(sanitizeTruck({ topper: "spaceship" }), null);                // bad topper + rest default → null
});

test("a truck design rides along on a vendor listing", () => {
  const { listing } = sanitizeListing({ name: "Tacos", items: [], truck: { body: "#000000", topper: "taco" } });
  assert.equal(listing.truck.body, "#000000");
  assert.equal(listing.truck.topper, "taco");
  // a default/empty truck is not stored
  const plain = sanitizeListing({ name: "Tacos", items: [] });
  assert.equal(plain.listing.truck, undefined);
});

require("dotenv").config();

const express = require("express");
const path = require("node:path");
const { MongoClient } = require("mongodb");

const app = express();
const port = Number(process.env.PORT) || 3000;
const textField = process.env.REVIEW_TEXT_FIELD || "review";
const collectionNames = {
  1: process.env.MONGO_COLLECTION_1 || "reviews_1_star",
  2: process.env.MONGO_COLLECTION_2 || "reviews_2_star",
  3: process.env.MONGO_COLLECTION_3 || "reviews_3_star",
  4: process.env.MONGO_COLLECTION_4 || "reviews_4_star",
  5: process.env.MONGO_COLLECTION_5 || "reviews_5_star",
};

let mongoClient;
let mongoClientPromise;

async function getDatabase() {
  if (!process.env.MONGODB_URI) {
    const error = new Error(
      "MongoDB is not configured. Add MONGODB_URI to your .env file.",
    );
    error.status = 503;
    throw error;
  }

  if (!mongoClientPromise) {
    mongoClient = new MongoClient(process.env.MONGODB_URI);
    mongoClientPromise = mongoClient.connect().catch((error) => {
      mongoClient = undefined;
      mongoClientPromise = undefined;
      throw error;
    });
  }

  await mongoClientPromise;
  return mongoClient.db(process.env.MONGO_DB_NAME || undefined);
}

const liveServerOrigins = new Set([
  "http://localhost:5500",
  "http://127.0.0.1:5500",
]);

app.use("/api", (request, response, next) => {
  const origin = request.get("Origin");
  if (liveServerOrigins.has(origin)) {
    response.set("Access-Control-Allow-Origin", origin);
    response.set("Vary", "Origin");
    response.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    response.set("Access-Control-Allow-Headers", "Accept");
  }

  if (request.method === "OPTIONS") return response.sendStatus(204);
  return next();
});

app.get("/api/review-config", (_request, response) => {
  response.json({ googleReviewUrl: process.env.GOOGLE_REVIEW_URL || "" });
});

app.get("/api/review-keywords", (request, response) => {
  const keywordsByRating = {
    1: [
      "high pricing",
      "poor quality match",
      "staff behaviour issues",
      "value for money concerns",
      "customer service gaps",
      "limited collection",
      "disappointing experience",
      "not recommended",
    ],
    2: [
      "below expectations",
      "average product quality",
      "pricey relative to quality",
      "inattentive service",
      "needs improvement",
      "mixed collection",
      "service inconsistency",
      "not fully satisfied",
    ],
    3: [
      "average overall experience",
      "decent variety",
      "okay but high pricing",
      "standard service",
      "mixed feedback",
      "convenient location",
      "nothing outstanding",
      "middle-of-the-road",
    ],
    4: [
      "good collection and variety",
      "helpful staff",
      "positive overall visit",
      "minor pricing notes",
      "convenient store",
      "recommended with small caveats",
      "solid local option",
      "pleasant shopping",
    ],
    5: [
      "excellent variety",
      "great collection",
      "friendly and helpful staff",
      "good value and quality",
      "highly recommended",
      "impressive product range",
      "smooth billing experience",
      "wonderful store visit",
    ],
  };
  const rating = Number(request.query.rating);
  const labels =
    keywordsByRating[rating] || Object.values(keywordsByRating).flat();

  response.json({
    keywords: labels.map((label) => ({
      label,
      category: `${rating || "All"}-star feedback`,
    })),
  });
});

app.get("/api/reviews/:rating", async (request, response) => {
  const rating = Number(request.params.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return response
      .status(400)
      .json({ error: "Rating must be a whole number from 1 to 5." });
  }

  try {
    const db = await getDatabase();
    const collection = db.collection(collectionNames[rating]);
    const documents = await collection.find({}).limit(1000).toArray();
    const fieldCandidates = [
      textField,
      "review",
      "reviewText",
      "text",
      "content",
      "comment",
      "body",
    ];
    const keywords = request.query.keyword;
    const selectedKeywords = (
      Array.isArray(keywords) ? keywords : keywords ? [keywords] : []
    )
      .map((keyword) => String(keyword).trim().toLocaleLowerCase())
      .filter(Boolean);

    const matchingReviews = documents
      .map((document) => {
        if (typeof document === "string") return document;
        for (const field of fieldCandidates) {
          if (typeof document[field] === "string" && document[field].trim()) {
            return document[field].trim();
          }
        }
        return "";
      })
      .filter(
        (review) =>
          review &&
          (!selectedKeywords.length ||
            selectedKeywords.some((keyword) =>
              review.toLocaleLowerCase().includes(keyword),
            )),
      );

    // Shuffle matching reviews so the regenerate button can show different ideas.
    for (let index = matchingReviews.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [matchingReviews[index], matchingReviews[swapIndex]] = [
        matchingReviews[swapIndex],
        matchingReviews[index],
      ];
    }

    return response.json({ reviews: matchingReviews.slice(0, 3) });
  } catch (error) {
    console.error("Could not load review suggestions:", error.message);
    return response.status(error.status || 500).json({
      error:
        error.status === 503
          ? error.message
          : "Could not read the selected rating collection. Check the MongoDB URI, database, and collection names.",
    });
  }
});

app.get("/", (_request, response) => {
  response.sendFile(path.join(__dirname, "review-suggestions.html"));
});

app.listen(port, () => {
  console.log(
    `Glamour Zone review page is running at http://localhost:${port}`,
  );
});

async function closeMongoConnection() {
  if (mongoClient) await mongoClient.close();
}

process.on("SIGINT", closeMongoConnection);
process.on("SIGTERM", closeMongoConnection);

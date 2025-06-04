from pymongo import MongoClient
from bson import json_util
import json
from datetime import datetime

def format_datetime(obj):
    if isinstance(obj, datetime):
        return obj.isoformat()
    return obj

def print_collection(collection_name, collection):
    print(f"\n{'='*50}")
    print(f"Collection: {collection_name}")
    print(f"{'='*50}")
    
    # Get all documents in the collection
    documents = list(collection.find())
    
    if not documents:
        print("No documents found")
        return
    
    # Print each document with nice formatting
    for i, doc in enumerate(documents, 1):
        print(f"\nDocument {i}:")
        # Convert ObjectId to string and format datetime
        formatted_doc = json.loads(json_util.dumps(doc))
        print(json.dumps(formatted_doc, indent=2, default=format_datetime))

def main():
    # Connect to MongoDB
    client = MongoClient('mongodb://localhost:27017/')
    db = client['cloaks-gambit']
    
    print("\nDatabase State Report")
    print(f"Generated at: {datetime.now().isoformat()}")
    print(f"Database: cloaks-gambit")
    
    # Get all collections
    collections = db.list_collection_names()
    
    if not collections:
        print("\nNo collections found in the database")
        return
    
    # Print each collection's contents
    for collection_name in collections:
        collection = db[collection_name]
        print_collection(collection_name, collection)
    
    # Close the connection
    client.close()

if __name__ == "__main__":
    main() 
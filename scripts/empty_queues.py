from pymongo import MongoClient

def empty_queues():
    try:
        # Connect to MongoDB
        client = MongoClient('mongodb://localhost:27017/')
        db = client['cloaks-gambit']
        
        # Get the lobbies collection (plural)
        lobby = db.lobbies
        
        # Find the lobby document
        lobby_doc = lobby.find_one()
        
        if not lobby_doc:
            print("No lobby document found in the database")
            return
        
        # Update the lobby document to empty the queues
        result = lobby.update_one(
            {'_id': lobby_doc['_id']},
            {
                '$set': {
                    'rankedQueue': [],
                    'quickplayQueue': []
                }
            }
        )
        
        if result.modified_count > 0:
            print("Successfully emptied both queues")
            print(f"Previous queue sizes:")
            print(f"Ranked Queue: {len(lobby_doc.get('rankedQueue', []))} players")
            print(f"Quickplay Queue: {len(lobby_doc.get('quickplayQueue', []))} players")
        else:
            print("No changes were made to the queues")
            
    except Exception as e:
        print(f"An error occurred: {str(e)}")
    finally:
        # Close the connection
        client.close()

if __name__ == "__main__":
    # Ask for confirmation
    response = input("Are you sure you want to empty all queues? (yes/no): ")
    if response.lower() == 'yes':
        empty_queues()
    else:
        print("Operation cancelled") 
#!/usr/bin/env python3
"""
Main entry point for the project.
"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Add src to path
sys.path.insert(0, str(Path(__file__).parent / "src"))

# Load environment variables
load_dotenv()


def main():
    """Main function."""
    print("Project is ready!")
    print(f"Python version: {sys.version}")
    
    # Check for API keys
    api_keys = {
        "OpenAI": os.getenv("OPENAI_API_KEY"),
        "Anthropic": os.getenv("ANTHROPIC_API_KEY"),
        "Google": os.getenv("GOOGLE_API_KEY"),
        "DeepSeek": os.getenv("DEEPSEEK_API_KEY"),
    }
    
    print("\nAPI Keys Status:")
    for service, key in api_keys.items():
        status = "[OK] Configured" if key else "[--] Not configured"
        print(f"  {service}: {status}")


if __name__ == "__main__":
    main()
# Client for Vite JSON Builder

This small client demonstrates how to send a JSON file tree to the Vite JSON Builder service.

Usage:

```bash
cd client
npm install
# Send the basic sample
SAMPLE=sample_vite_project.json npm run send
# Send the image sample
SAMPLE=sample_vite_project_with_image.json npm run send
# If server is at a different URL
SERVER_URL=http://127.0.0.1:3000/build npm run send
```

The client will download `build.zip` into the `client` folder.


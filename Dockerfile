# Use the official Node.js image as the base image
FROM node:20

# Create a directory for the application
WORKDIR /app

# Copy package.json and package-lock.json files
COPY package*.json ./

# Install application dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the NestJS application
RUN npm run build

# Environment variable for production
#RestApi
ENV PORT=4000
ENV JWT_SECRET="soci@l@bsSecr3t"

# Expose the port the app runs on
EXPOSE 4000
EXPOSE 4001
# Start the application
CMD ["npm", "run", "start:dev"]
# TestReg Registration App

A user registration web app deployed on AWS with full CRUD operations.

## Live URLs
- **Registration Form**: https://testreg.tadpoleindustries.com/register.html
- **CRUD Viewer**: https://testreg.tadpoleindustries.com/viewer.html

## Architecture
- **Frontend**: Static HTML hosted on S3 + CloudFront CDN
- **API**: AWS API Gateway (HTTP API) + Lambda (Node.js 20)
- **Storage**: AWS S3 (registrations saved as JSON files)
- **Domain**: testreg.tadpoleindustries.com (Route 53 + ACM SSL)

## AWS Resources
| Resource | Name/ID |
|----------|---------|
| S3 Bucket | schinta-registration-app-202604300446 |
| CloudFront | E12VEGYPF6J373 |
| API Gateway | x7g2e51ala (eu-west-1) |
| Lambda | testreg-save |
| ACM Cert | us-east-1 (testreg.tadpoleindustries.com) |

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | /prod/register | Create registration |
| GET | /prod/registrations | List all registrations |
| GET | /prod/registrations/{id} | Get one registration |
| PUT | /prod/registrations/{id} | Update registration |
| DELETE | /prod/registrations/{id} | Delete registration |

## Files
- `register.html` - Registration form (Create)
- `viewer.html` - CRUD viewer (Read, Update, Delete)
- `lambda/index.js` - Lambda function handling all API operations

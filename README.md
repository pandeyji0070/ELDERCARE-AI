ELDERCARE AI

An elderly care and medication management platform designed to help elderly users, caregivers, and family members coordinate daily care.

Problem Statement

Elderly people may face difficulties managing medication schedules, tracking doses, remembering appointments, and communicating health updates with caregivers and family members.

Our Solution

ELDERCARE AI provides a shared care interface with dedicated sections for elderly users, caregivers, and family members.

Key Features

* Elderly care dashboard
* Medication schedule and dose tracking
* Caregiver dashboard and alerts
* Family care overview and adherence history
* Appointment management interface
* SOS emergency assistance interface
* Firestore-based data persistence
* Authentication and database security controls

Technology Stack

* Frontend: React, TypeScript, Vite
* Backend: Express, TypeScript
* Database: Firebase Cloud Firestore
* Deployment: Google Cloud Run

How It Works

1. Users access the application.
2. Care information and medication schedules are displayed.
3. Caregivers can monitor medication status.
4. Family members can review adherence information.
5. Users can access the SOS interface for emergency assistance.

Testing

The following checks should be performed before production use:

* Application loads successfully.
* Medication records persist after refreshing.
* Dose status updates are saved.
* Unauthenticated database access is rejected.
* Caregiver and family dashboards display the available care information.
* SOS interface and emergency actions are tested.

Security

The application uses Firebase authentication and Firestore security rules. Access control should be reviewed and tested before using real patient information.

Assumptions and Limitations

* Demo data is used for demonstration.
* Cross-account Care Circle sharing requires further verification.
* Email notifications and emergency workflows require end-to-end testing.
* This project is a prototype and is not a substitute for professional medical care.

Deployment

ELDERCARE AI is deployed using Google Cloud Run.

Project

ELDERCARE AI — Elderly Care & Medication Management Platform
# ha-referral-app
Home Appetite referral application

To run write following command in terminal:

npm install -g nodemon

nodemon index

To see in action open in postman hitting following endpoints:

/api: simple get call to check if the server is functioning

/api/checkReferralValidity: post call please send json body in request template:

{
    "referredUseremail" : "test@test.com",
    "userEmail" : "sid@gmail.com"
}

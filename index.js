const express = require("express");
const bodyParser = require('body-parser')
require('dotenv').config();
var nodemailer = require('nodemailer');
const PORT = process.env.PORT || 3001;
const app = express();
const http = require('http');
const httpServer = http.createServer(app);
const axios = require("axios");
const cors = require('cors');

app.use(cors());

// Local db connection

const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'testdb',
    password: 'JTBT7c1!',
    port: 5432,
});

pool.on('error', (err, client) => {
    console.error('Error:', err);
});

var insertIntoDB = function (referringuseremail, referreduseremail, discountcode, referraldate, existinguserFlag) {
    const query = existinguserFlag ?
        `UPDATE referrals SET referringuserdiscountcode = '${discountcode}', referreduserfirstpurchase='${existinguserFlag}' WHERE referreduseremail = '${referringuseremail}'`
        :
        `
    INSERT INTO referrals (referringuseremail, referreduseremail, referringuserdiscountcode, 
        referreduserdiscountcode, referraldate,  referreduserfirstpurchase)
    VALUES ('${referringuseremail}', '${referreduseremail}', '', '${discountcode}','${referraldate}', false )
    `;

    pool.connect()
        .then((client) => {
            client.query(query)
                .then(res => {
                    console.log('Data insert successful');
                })
                .catch(err => {
                    console.error(err);
                });
        })
        .catch(err => {
            console.error(err);
        });
}
// set transporter variable for email trigger using nodemailer

var transporter = nodemailer.createTransport({
    host: process.env.MAIL_SERVER,
    port: 465,
    auth: {
        user: process.env.MAIL_USERNAME,
        pass: process.env.MAIL_PASSWORD
    },
    tls: {
        rejectUnauthorized: false
    }
});

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.get("/api", (req, res) => {
    res.json({ message: "Hello from server!!!!" });
});

// Helper Functions Start

// Function for Email to be sent to the referred user with registration link

var sendRegistrationEmail = function (res) {
    var registerPromptMail = {
        from: process.env.MAIL_USERNAME,
        to: res,
        subject: 'Sending Registration Email using Node.js',
        text: 'Please register through this link: #sampleLink'
    };

    transporter.sendMail(registerPromptMail, function (error, info) {
        if (error) {
            console.log(error);
        } else {
            console.log('Email sent: ' + info.response);
        }
    });
}

// Function for sending discount code to REFERRED user

var sendReferredUserDiscountCode = function (res, discountCode) {
    var discountCodeMail = {
        from: process.env.MAIL_USERNAME,
        to: res,
        subject: 'Sending Discount Code Email using Node.js',
        text: `Please use this code ${discountCode} in your next purchase to get $25 off`
    };

    transporter.sendMail(discountCodeMail, function (error, info) {
        if (error) {
            console.log(error);
        } else {
            console.log('Referral user Email sent: ' + info.response);
        }
    });
}

// Function for sending discount code to EXISTING user

var sendExistingUserDiscountCode = function (res, discountCode) {
    var discountCodeMail = {
        from: process.env.MAIL_USERNAME,
        to: res,
        subject: 'Sending Discount Code Email using Node.js',
        text: `Your referral is completed. Please use this code ${discountCode} in your next purchase to get $25 off`
    };

    transporter.sendMail(discountCodeMail, function (error, info) {
        if (error) {
            console.log(error);
        } else {
            console.log('Existing user Email sent: ' + info.response);
        }
    });
}

var generateCode = function (length) {
    var result = '';
    var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (var i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

var date = new Date().toJSON();

// GraphQL call to shopify admin for creating Discount Code

var discountCodeApi = function (res, userId, referringuseremail, referreduseremail, existinguserFlag) {
    const discountCode = generateCode(7);
    var data2 = JSON.stringify({
        query: `mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
            discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
              codeDiscountNode {
                id
              }
              userErrors {
                field
                message
              }
            }
          }`,
        variables: {
            "basicCodeDiscount": {
                "appliesOncePerCustomer": true, "code": `${discountCode}`,
                "title": "Generated Discount", "startsAt": `${date}`, "customerGets": {
                    "items": { "all": true },
                    "value": { "discountAmount": { "amount": 25, "appliesOnEachItem": false } }
                },
                "customerSelection": { "customers": { "add": [`${userId}`] } }
            }
        }
    });

    // set config2 variable for shopify GraphQL call 

    var config2 = {
        method: 'post',
        url: process.env.SHOPIFY_URL,
        headers: {
            'X-Shopify-Access-Token': process.env.SHOPIFY_TOKEN,
            'Content-Type': 'application/json',
            "Accept-Encoding": "gzip,deflate,compress"
        },
        data: data2
    };

    axios(config2)
        .then(function (response) {
            console.log(JSON.stringify(response.data));
            if (response.data.data.discountCodeBasicCreate.codeDiscountNode !== null) {
                existinguserFlag ?  sendExistingUserDiscountCode(referreduseremail, discountCode) : sendReferredUserDiscountCode(referreduseremail, discountCode);
                insertIntoDB(referringuseremail, referreduseremail, discountCode, date, existinguserFlag);
                res.send({msg: `Discount code sent to ${referreduseremail}.`, status: 200});
            } else {
                res.send({msg: response.data.data.discountCodeBasicCreate.userErrors[0].message, status: 400});
            }
        })
        .catch(function (error) {
            console.log(error);
            res.send(error);
        });
}

// Helper Functions End

// Trigger when existing user wants to refer any new user

app.post('/api/checkReferralValidity', (req, res) => {
    const { referredUseremail, userEmail } = req.body;
    const existinguserFlag = false;
    let checkReferredUserStatus;
    // GraphQL call to shopify admin for checking the referred user email in db

    var data = JSON.stringify({
        query: `{
          customers(query:"(email:${referredUseremail}) OR (email:${userEmail})", first: 2) {
              edges {
                  node {
                    id
                    email
                    numberOfOrders
                  }
              }
          }
      }`,
        variables: {}
    });

    // set config variable for shopify GraphQL call 

    var config = {
        method: 'post',
        url: process.env.SHOPIFY_URL,
        headers: {
            'X-Shopify-Access-Token': process.env.SHOPIFY_TOKEN,
            'Content-Type': 'application/json',
            "Accept-Encoding": "gzip,deflate,compress"
        },
        data: data
    };

    checkReferredUser(referredUseremail)
        .then(function (result) {
            checkReferredUserStatus = result;
        }).catch(function (err) {
            console.log(err);
        });

    // GraphQL call

    axios(config)
        .then(function (response) {
            console.log(JSON.stringify(response.data));
            const resArr = response.data.data.customers.edges;
            const index = resArr.findIndex(e => e.node.email === referredUseremail)
            let userId;
            if (index > -1) {
                userId = resArr[index].node.id;
            }
            // conditions to be checked for a valid referral
            if (resArr.length < 2 && resArr[0].node.numberOfOrders > 0 && resArr[0].node.email === userEmail) {
                sendRegistrationEmail(referredUseremail);
                res.send("Valid referral. User is not registereed with us. Registration email sent.");
            }
            else if (resArr.length < 2 && resArr[0].node.numberOfOrders === '0' && resArr[0].node.email === userEmail) {
                res.send("Invalid referral. You have not completed your first order.");
            }
            else if (resArr.length === 2 && index > -1 && resArr[index].node.numberOfOrders === '0') {
                if (checkReferredUserStatus) {
                    res.send("Invalid referral. Referred user already has a referral from another registered user.");
                } else {
                    discountCodeApi(res, userId, userEmail, referredUseremail, existinguserFlag);
                }
            }
            else {
                res.send("Invalid referral. Referred user is already registered with us and has more than 1 or equal orders.");
            }

        })
        .catch(function (error) {
            console.log(error);
            res.send(error);
        });
});

// Trigger when referred user register from the given link in email

app.post('/api/sendReferredUserDiscountCode', (req, res) => {
    const { referredUseremail, userEmail } = req.body;
    const existinguserFlag = false;
    // GraphQL call to shopify admin for checking th referred user email in db to extract Id

    var data = JSON.stringify({
        query: `{
              customers(query:"email:${referredUseremail}", first: 1) {
                  edges {
                      node {
                        id
                        email
                      }
                  }
              }
          }`,
        variables: {}
    });

    // set config variable for shopify GraphQL call 

    var config = {
        method: 'post',
        url: process.env.SHOPIFY_URL,
        headers: {
            'X-Shopify-Access-Token': process.env.SHOPIFY_TOKEN,
            'Content-Type': 'application/json',
            "Accept-Encoding": "gzip,deflate,compress"
        },
        data: data
    };

    checkReferredUser(referredUseremail)
        .then(function (result) {
            checkReferredUserStatus = result;
        }).catch(function (err) {
            console.log(err);
        });

    // GraphQL call 1 to get referred user Id from db

    axios(config)
        .then(function (response) {
            console.log(JSON.stringify(response.data));

            if (response.data.data.customers.edges.length !== 0) {

                // GraphQL call 2 to get send code to referred user

                const userId = response.data.data.customers.edges[0].node.id;
                if (checkReferredUserStatus) {
                    res.send(
                        {msg: "Invalid referral. Referred user already has a referral from another registered user.", status: 400});
                } else {
                    discountCodeApi(res, userId, userEmail, referredUseremail, existinguserFlag);
                }

            } else {
                res.send({msg: 'Referred User is not registered with us.', status: 400})
            }
        })
        .catch(function (error) {
            console.log(error);
            res.send(error);
        });
});

// Trigger when referred user uses the Discount code and completes first order

app.post('/api/sendExistingUserDiscountCode', (req, res) => {
    const { referredUseremail, userEmail } = req.body;
    const existinguserFlag = true;
    // GraphQL call to shopify admin for checking the referred user number of orders
    var data = JSON.stringify({
        query: `{
          customers(query:"(email:${referredUseremail}) OR (email:${userEmail})", first: 2) {
              edges {
                  node {
                    id
                    email
                    numberOfOrders
                  }
              }
          }
      }`,
        variables: {}
    });

    // set config variable for shopify GraphQL call 

    var config = {
        method: 'post',
        url: process.env.SHOPIFY_URL,
        headers: {
            'X-Shopify-Access-Token': process.env.SHOPIFY_TOKEN,
            'Content-Type': 'application/json',
            "Accept-Encoding": "gzip,deflate,compress"
        },
        data: data
    };

    // GraphQL call 1 to get user Id from db

    axios(config)
        .then(function (response) {
            console.log(JSON.stringify(response.data));
            const resArr = response.data.data.customers.edges;
            const index = resArr.findIndex(e => e.node.email === referredUseremail)
            const index2 = resArr.findIndex(e => e.node.email === userEmail)
            let userId;
            if (index2 > -1) {
                userId = resArr[index2].node.id;
            }

            if (resArr.length === 2 && index > -1 && resArr[index].node.numberOfOrders > 0) {

                // GraphQL call 2 to get send code to existing user

                discountCodeApi(res, userId, referredUseremail, userEmail, existinguserFlag);
            } else {
                res.send('Referred User has not completed there first order.')
            }
        })
        .catch(function (error) {
            console.log(error);
            res.send(error);
        });

});

app.get("/api/getAllDiscountCodes", (req, res) => {

    // GraphQL call to shopify admin for getting all discount codes 
    var data = JSON.stringify({
        query: `{
                    codeDiscountNodes(first:100) {
                        edges{
                            node{
                                codeDiscount{
                                    ... on DiscountCode {
                                        ... on DiscountCodeBasic {
                                            title
                                            startsAt
                                            codes(first:1){
                                                edges{
                                                    node{
                                                        code
                                                    }
                                                }
                                            }
                                            customerSelection {
                                                ... on DiscountCustomers {
                                                    customers {
                                                        email
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
        `,
        variables: {}
    });

    // set config variable for shopify GraphQL call 

    var config = {
        method: 'post',
        url: process.env.SHOPIFY_URL,
        headers: {
            'X-Shopify-Access-Token': process.env.SHOPIFY_TOKEN,
            'Content-Type': 'application/json',
            "Accept-Encoding": "gzip,deflate,compress"
        },
        data: data
    };

    axios(config)
        .then(function (response) {
            console.log(JSON.stringify(response.data));
            let responseData = [];
            const resArr = response.data.data.codeDiscountNodes.edges;
            resArr.map(item => {
                let referredUseremail;
                if (item.node.codeDiscount.customerSelection.customers === undefined) {
                    referredUseremail = '';
                } else {
                    referredUseremail = item.node.codeDiscount.customerSelection.customers[0].email;
                }
                const obj = {
                    referredUseremail: referredUseremail,
                    referralDate: item.node.codeDiscount.startsAt,
                    discountCode: item.node.codeDiscount.codes.edges[0].node.code
                }

                responseData.push(obj);
            });
            res.json(responseData);
        })
        .catch(function (error) {
            console.log(error);
            res.send(error);
        });
});

const getReferrals = (request, response) => {
    pool.query('SELECT * FROM referrals', (error, results) => {
        let responseData = [];
        if (error) {
            throw error
        }
        const resArr = results.rows;
        resArr.map(item => {
            const obj = {
                referringUseremail: item.referringuseremail,
                referredUseremail: item.referreduseremail,
                referredUserDiscountCode: item.referreduserdiscountcode
            }
            responseData.push(obj);
        });
        response.status(200).json(responseData);
    })
}

app.get("/api/getReferralData", getReferrals);

const getReferralByCode = (request, response) => {
    const code = request.params.code;

    pool.query('SELECT * FROM referrals WHERE referredUserDiscountCode = $1', [code], (error, results) => {
        if (error) {
            throw error
        }
        response.status(200).json(results.rows)
    })
}

app.get("/api/getReferralByCode/:code", getReferralByCode);

var checkReferredUser = function (referredUseremail) {
    return new Promise(function (resolve, reject) {
        pool.query('SELECT * FROM referrals WHERE referreduseremail = $1', [referredUseremail], (error, results) => {
            if (error)
                return reject(error);
            resolve(results.rows.length > 0);
        })
    });
}

httpServer.listen(PORT, () => {
    console.log(`Server listening on ${PORT}`);
});
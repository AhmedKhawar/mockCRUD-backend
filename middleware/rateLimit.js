import rateLimit from "express-rate-limit";


export const resourceLimit = rateLimit({
    windowMs: 60  * 60 * 1000,
    max: 20,
    message:{
        status: 409,
        message: "Too many requests, only 20 requests allowed in an hour"
    },
    standardHeaders: true, 
    legacyHeaders: false
})


export const projectLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message:{
        status: 409,
        message: "Too many requests, only 10 requests allowed every 15 minutes"
    },
    standardHeaders: true, 
    legacyHeaders: false
})


export const authLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message:{
        status: 409,
        message: "Too many requests, only 5 requests allowed every 15 minutes"
    },
    standardHeaders: true, 
    legacyHeaders: false
})
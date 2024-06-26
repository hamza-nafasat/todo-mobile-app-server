import fs from "fs";
import { User } from "../models/users.js";
import { removeFromCloudinary, uploadOnCloudinary } from "../utils/cloudinary.js";
import { sendMail } from "../utils/sendMail.js";
import { sendToken } from "../utils/sendToken.js";

export const register = async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const avatar = req.files?.avatar?.tempFilePath;
        if (!name || !email || !password || !avatar) {
            return res
                .status(400)
                .json({ success: false, message: "All fields name email password and avatar are required" });
        }
        let user = await User.findOne({ email });
        if (user) return res.status(400).json({ success: false, message: "User already exists" });
        // if user not exist send otp
        const otp = Math.floor(Math.random() * 1000000);
        // file upload on cloudinary
        const myCloud = await uploadOnCloudinary(avatar, "user-avatars");
        if (!myCloud?.public_id || !myCloud?.secure_url)
            return next(new CustomError("Error While Uploading File", 500));
        // --------------------------------------------------------------------
        user = await User.create({
            name,
            email,
            password,
            avatar: {
                public_id: myCloud.public_id,
                url: myCloud.secure_url,
            },
            otp,
            otp_expiry: new Date(Date.now() + process.env.OTP_EXPIRE * 60 * 1000),
        });
        await sendMail(email, "Verify your account", `Your OTP is ${otp}`);
        fs.rmSync("./tmp", { recursive: true });
        sendToken(res, user, 201, "OTP sent to your email, please verify your account from your profile");
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const verify = async (req, res) => {
    try {
        const otp = Number(req.body.otp);
        const user = await User.findById(req.user._id);
        if (user.otp !== otp || user.otp_expiry < Date.now()) {
            return res.status(400).json({ success: false, message: "Invalid OTP or has been Expired" });
        }
        user.verified = true;
        user.otp = null;
        user.otp_expiry = null;
        await user.save();
        sendToken(res, user, 200, "Your Account Verified Successfully");
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, message: "Please enter all fields" });
        }
        const user = await User.findOne({ email }).select("+password");
        if (!user) {
            return res.status(400).json({ success: false, message: "Invalid Email Address" });
        }
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: "Incorrect Password" });
        }
        sendToken(res, user, 200, "Welcome back " + user?.name.toUpperCase());
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const logout = async (req, res) => {
    try {
        res.status(200)
            .cookie("token", null, {
                expires: new Date(Date.now()),
            })
            .json({ success: true, message: "Logged out successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const addTask = async (req, res) => {
    try {
        const { title, description } = req.body;
        if (!title || !description)
            return res.status(400).json({ success: false, message: "Please enter title and description" });
        const user = await User.findById(req.user._id);
        user.tasks.push({
            title,
            description,
            completed: false,
            createdAt: new Date(Date.now()),
        });
        await user.save();
        res.status(200).json({ success: true, message: "Task added successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const removeTask = async (req, res) => {
    try {
        const { taskId } = req.params;
        const user = await User.findById(req.user._id);
        user.tasks = user.tasks.filter((task) => task._id.toString() !== taskId.toString());
        await user.save();
        res.status(200).json({ success: true, message: "Task removed successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const updateTask = async (req, res) => {
    try {
        const { taskId } = req.params;
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(400).json({ success: false, message: "User not found" });
        }
        let task = user.tasks.find((task) => task._id.toString() === taskId.toString());
        task.completed = !task.completed;
        await user.save();
        res.status(200).json({ success: true, message: "Task Updated successfully" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getMyProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user?._id);
        if (!user) {
            return res.status(400).json({ success: false, message: "User not found" });
        }
        sendToken(res, user, 201, `Welcome back ${user?.name}`);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const updateProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        const { name } = req.body;
        const avatar = req.files?.avatar?.tempFilePath;
        if (name) user.name = name;
        if (avatar) {
            await removeFromCloudinary(user.avatar.public_id);
            const myCloud = await uploadOnCloudinary(avatar, "user-avatars");
            if (!myCloud?.public_id || !myCloud?.secure_url)
                return next(new CustomError("Error While Uploading File", 500));
            // --------------------------------------------------------------------
            user.avatar = {
                public_id: myCloud.public_id,
                url: myCloud.secure_url,
            };
        }
        fs.rmSync("./tmp", { recursive: true });
        await user.save();
        res.status(200).json({ success: true, message: "Profile Updated successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const updatePassword = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select("+password");
        const { oldPassword, newPassword } = req.body;
        if (!oldPassword || !newPassword) {
            return res.status(400).json({ success: false, message: "Please enter all fields" });
        }
        const isMatch = await user.comparePassword(oldPassword);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: "Invalid Old Password Please Try Again" });
        }
        user.password = newPassword;
        await user.save();
        res.status(200).json({ success: true, message: "Password Updated successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const forgetPassword = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, message: "Please enter email" });
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ success: false, message: "Invalid Email" });
        const otp = Math.floor(Math.random() * 1000000);
        user.resetPasswordOtp = otp;
        user.resetPasswordOtpExpiry = Date.now() + 10 * 60 * 1000;
        await user.save();
        const message = `Your OTP for reset your password ${otp}. If you did not request for this, please ignore this email.`;
        await sendMail(email, "Request for Reset Password", message);
        res.status(200).json({ success: true, message: `OTP sent to this ${email}` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const resetPassword = async (req, res) => {
    try {
        const { otp, newPassword } = req.body;
        const user = await User.findOne({
            resetPasswordOtp: otp,
            resetPasswordExpiry: { $gt: Date.now() },
        });
        if (!user) {
            return res.status(400).json({ success: false, message: "Otp Invalid or has been Expired" });
        }
        user.password = newPassword;
        user.resetPasswordOtp = null;
        user.resetPasswordExpiry = null;
        await user.save();
        res.status(200).json({ success: true, message: `Password Changed Successfully Noe You Can Login` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

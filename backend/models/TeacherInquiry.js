const mongoose=require('mongoose');
const s=new mongoose.Schema({
  teacher:{type:mongoose.Schema.Types.ObjectId,ref:'Teacher',required:true},
  teacherId:{type:String,required:true,index:true},
  teacherName:{type:String,required:true},
  teacherEmail:{type:String,required:true},
  school:{type:mongoose.Schema.Types.ObjectId,ref:'School',required:true},
  schoolId:{type:String,required:true,index:true},
  category:{type:String,enum:['attendance_issue','leave_request','technical_issue','general_support','other'],default:'general_support',required:true},
  subject:{type:String,required:true,trim:true,maxlength:200},
  message:{type:String,required:true,trim:true,maxlength:2000},
  status:{type:String,enum:['open','in_progress','resolved','closed'],default:'open',index:true},
  adminReply:{type:String,trim:true,default:null},
  resolvedAt:{type:Date,default:null},
  resolvedBy:{type:String,default:null},
},{timestamps:true});
s.index({schoolId:1,createdAt:-1});s.index({teacherId:1,createdAt:-1});
module.exports=mongoose.model('TeacherInquiry',s);

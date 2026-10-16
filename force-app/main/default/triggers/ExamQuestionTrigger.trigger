trigger ExamQuestionTrigger on Exam_Question__c (before insert,after insert) {
	 // Instantiate the handler class
    ExamQuestionTriggerHandler handler = new ExamQuestionTriggerHandler();
    
    // Route execution to the handler when conditions match
    if (Trigger.isBefore && Trigger.isInsert) {
        handler.handleBeforeInsert(Trigger.new);
    }
    
    if (Trigger.isAfter && Trigger.isInsert) {
        handler.handleAfterInsert(Trigger.new);
    }
}
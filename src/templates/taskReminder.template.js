'use strict';

const getTaskReminderTemplate = ({ title, assigneeName, taskTitle, dueDate, status, message }) => {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px; background-color: #ffffff;">
      <div style="text-align: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #e5e7eb;">
        <h1 style="color: #0F766E; margin: 0;">HRIS Task Reminder</h1>
      </div>
      <h2 style="color: #111827; font-size: 18px; margin-bottom: 16px;">${title}</h2>
      <p style="color: #4b5563; font-size: 16px; line-height: 1.5; margin-bottom: 24px;">
        Hello ${assigneeName || 'Team Member'},<br/><br/>
        ${message}
      </p>
      
      <div style="background-color: #f9fafb; padding: 16px; border-radius: 6px; margin-bottom: 24px;">
        <p style="margin: 0 0 8px 0; font-size: 14px;"><strong style="color: #374151;">Task:</strong> ${taskTitle}</p>
        <p style="margin: 0 0 8px 0; font-size: 14px;"><strong style="color: #374151;">Due Date:</strong> ${dueDate}</p>
        <p style="margin: 0; font-size: 14px;"><strong style="color: #374151;">Status:</strong> ${status}</p>
      </div>
      
      <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 16px;">
        This is an automated notification from your HRIS Portal. Please log in to view more details.
      </p>
    </div>
  `;
};

module.exports = {
  getTaskReminderTemplate
};
